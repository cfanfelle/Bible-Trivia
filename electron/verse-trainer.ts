/**
 * electron/verse-trainer.ts
 *
 * Pure TypeScript verse memorization logic — no Electron dependencies.
 * All exported functions are fully unit-testable.
 *
 * CONTENT RULE: This module NEVER modifies or replaces user-supplied Master Text.
 * It only operates on the text the user explicitly provided.
 */

export interface Chunk {
  index: number;
  text: string;  // exactly as in master text (original capitalisation/punctuation)
  wordCount: number;
}

export type ExerciseType =
  | 'study'
  | 'word-bank'
  | 'easy-blanks'
  | 'hard-blanks'
  | 'first-letters'
  | 'chunk-recall'
  | 'combined-chunks'
  | 'full-recall';

export interface Exercise {
  type: ExerciseType;
  chunkIndices: number[];
  promptText: string;          // what to display as context/prompt
  displayText: string;         // text with blanks/hints shown
  wordBank?: string[];
  blankPositions?: number[];   // word indices that are blanked
}

export interface AttemptResult {
  score: number;               // 0.0–1.0
  correct: string[];
  typos: { word: string; typed: string }[];
  missing: string[];
  wrong: { expected: string; typed: string }[];
  extra: string[];
  reordered: boolean;
  passed: boolean;
}

export interface WeakWord {
  word: string;
  failCount: number;
}

export interface PerformanceEntry {
  level: number;
  score: number;
  timestamp: number;
  passed: boolean;
}

// ─── Mastery configuration (tunable) ─────────────────────────────────────────

export const MASTERY_THRESHOLDS = {
  bronze:  { minSuccessfulReviews: 1 },
  silver:  { minSuccessfulReviews: 3 },
  gold:    { minSuccessfulReviews: 6 },
  diamond: { minSuccessfulReviews: 10, minDaysSinceCreated: 30, minIntervalDays: 14 },
} as const;

// ─── Spaced review configuration (tunable) ────────────────────────────────────

export const REVIEW_INTERVALS = {
  afterLearn:    1,   // next day
  afterBronze:   3,
  afterSilver:   7,
  afterGold:     14,
  afterDiamond:  30,
} as const;

// ─── Text normalisation ───────────────────────────────────────────────────────

/**
 * Normalise text for comparison: lowercase, strip punctuation (except apostrophes
 * in contractions), collapse whitespace.  Does NOT alter the original master text.
 */
export function normalizeForComparison(text: string): string {
  return text
    .toLowerCase()
    // Remove punctuation except apostrophes inside words
    .replace(/["""'']/g, "'")    // smart quotes to straight
    .replace(/[^a-z0-9'\s]/g, ' ')
    .replace(/'\s/g, ' ')        // trailing apostrophes
    .replace(/\s'/g, ' ')        // leading apostrophes
    .replace(/\s+/g, ' ')
    .trim();
}

/** Split normalised text into word tokens. */
export function tokenize(text: string): string[] {
  return normalizeForComparison(text).split(' ').filter(Boolean);
}

// ─── Levenshtein distance ─────────────────────────────────────────────────────

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const row: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = i;
    for (let j = 1; j <= n; j++) {
      const val = a[i - 1] === b[j - 1] ? row[j - 1] : 1 + Math.min(row[j - 1], row[j], prev);
      row[j - 1] = prev;
      prev = val;
    }
    row[n] = prev;
  }
  return row[n];
}

/** Returns true if the typed word is a likely typo of the expected word. */
function isTypo(expected: string, typed: string): boolean {
  if (expected.length < 3) return false;           // short words need exact match
  const dist = levenshtein(expected, typed);
  const maxLen = Math.max(expected.length, typed.length);
  return dist > 0 && dist <= Math.max(1, Math.floor(maxLen * 0.25));
}

// ─── Attempt comparison ───────────────────────────────────────────────────────

/**
 * Compare the user's typed attempt against the master text.
 * Handles normalisation, typo detection, missing/extra/wrong words.
 */
export function compareAttempt(masterText: string, attempt: string): AttemptResult {
  const expected = tokenize(masterText);
  const typed    = tokenize(attempt);

  if (expected.length === 0) {
    return { score: 1, correct: [], typos: [], missing: [], wrong: [], extra: [], reordered: false, passed: true };
  }

  // DP longest-common-subsequence alignment
  const lcs = lcsMatrix(expected, typed);
  const alignment = backtrack(lcs, expected, typed);

  const correct: string[] = [];
  const typos: { word: string; typed: string }[] = [];
  const missing: string[] = [];
  const wrong: { expected: string; typed: string }[] = [];
  const extra: string[] = [];
  let reordered = false;

  let lastExpectedIdx = -1;
  let lastTypedIdx    = -1;

  for (const step of alignment) {
    if (step.type === 'match') {
      correct.push(expected[step.ei]);
      if (step.ei < lastExpectedIdx || step.ti < lastTypedIdx) reordered = true;
      lastExpectedIdx = step.ei;
      lastTypedIdx    = step.ti;
    } else if (step.type === 'typo') {
      typos.push({ word: expected[step.ei], typed: typed[step.ti] });
      lastExpectedIdx = step.ei;
      lastTypedIdx    = step.ti;
    } else if (step.type === 'delete') {
      missing.push(expected[step.ei]);
    } else if (step.type === 'insert') {
      extra.push(typed[step.ti]);
    } else if (step.type === 'replace') {
      wrong.push({ expected: expected[step.ei], typed: typed[step.ti] });
    }
  }

  // Score: correct (full) + typo (half) — normalised by expected word count
  const numerator = correct.length + typos.length * 0.5;
  const score = Math.min(1, numerator / expected.length);

  // Pass threshold: score ≥ 0.85 (typos don't cause failure on their own)
  const passed = score >= 0.85 && missing.length === 0 && wrong.length === 0;

  return { score, correct, typos, missing, wrong, extra, reordered, passed };
}

// Minimal edit-script alignment
interface AlignStep {
  type: 'match' | 'typo' | 'delete' | 'insert' | 'replace';
  ei: number;
  ti: number;
}

function lcsMatrix(a: string[], b: string[]): number[][] {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  return dp;
}

function backtrack(dp: number[][], a: string[], b: string[]): AlignStep[] {
  const steps: AlignStep[] = [];
  let i = a.length, j = b.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      steps.unshift({ type: 'match', ei: i - 1, ti: j - 1 });
      i--; j--;
    } else if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1]) {
      // Possible replace — check for typo
      const t = isTypo(a[i - 1], b[j - 1]) ? 'typo' : 'replace';
      steps.unshift({ type: t, ei: i - 1, ti: j - 1 });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      steps.unshift({ type: 'insert', ei: i, ti: j - 1 });
      j--;
    } else {
      steps.unshift({ type: 'delete', ei: i - 1, ti: j });
      i--;
    }
  }
  return steps;
}

// ─── Text chunking ────────────────────────────────────────────────────────────

const MAX_CHUNK_WORDS = 15;
const MIN_CHUNK_WORDS = 4;

/**
 * Split masterText into learnable chunks.
 * Preference: sentence > clause > half.
 * A single short verse returns a single chunk.
 */
export function chunkText(masterText: string): Chunk[] {
  const raw = masterText.trim();
  if (!raw) return [];

  // Split on sentence boundaries first
  const sentences = splitOnPattern(raw, /(?<=[.!?])\s+/);
  const chunks: Chunk[] = [];

  for (const sentence of sentences) {
    const words = sentence.trim().split(/\s+/);
    if (words.length <= MAX_CHUNK_WORDS) {
      chunks.push(makeChunk(sentence.trim(), chunks.length));
    } else {
      // Try splitting on clause boundaries (; :)
      const clauses = splitOnPattern(sentence, /[;:]\s+/);
      if (clauses.length > 1) {
        for (const clause of clauses) {
          const cWords = clause.trim().split(/\s+/);
          if (cWords.length <= MAX_CHUNK_WORDS) {
            chunks.push(makeChunk(clause.trim(), chunks.length));
          } else {
            // Split on commas
            const commaClauses = splitOnPattern(clause, /,\s+/);
            if (commaClauses.length > 1) {
              for (const cc of commaClauses) {
                splitIntoSizedChunks(cc.trim(), chunks);
              }
            } else {
              splitIntoSizedChunks(clause.trim(), chunks);
            }
          }
        }
      } else {
        // Long sentence with no clause boundaries — split by half
        splitIntoSizedChunks(sentence.trim(), chunks);
      }
    }
  }

  // Merge tiny chunks (< MIN_CHUNK_WORDS) with their neighbour
  return mergeTinyChunks(chunks);
}

function makeChunk(text: string, index: number): Chunk {
  return { index, text, wordCount: text.split(/\s+/).length };
}

function splitOnPattern(text: string, pattern: RegExp): string[] {
  const parts: string[] = [];
  let remaining = text;
  let match;
  pattern.lastIndex = 0;
  const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : 'g' + pattern.flags);
  let last = 0;
  re.lastIndex = 0;
  while ((match = re.exec(text)) !== null) {
    parts.push(text.slice(last, match.index + (match[0].length > 1 ? 1 : 0)));
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.filter(p => p.trim().length > 0);
}

function splitIntoSizedChunks(text: string, chunks: Chunk[]): void {
  const words = text.split(/\s+/);
  const mid = Math.ceil(words.length / 2);
  const a = words.slice(0, mid).join(' ');
  const b = words.slice(mid).join(' ');
  if (a) chunks.push(makeChunk(a, chunks.length));
  if (b) chunks.push(makeChunk(b, chunks.length));
}

function mergeTinyChunks(chunks: Chunk[]): Chunk[] {
  if (chunks.length <= 1) return chunks.map((c, i) => ({ ...c, index: i }));
  const merged: Chunk[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    if (c.wordCount < MIN_CHUNK_WORDS && merged.length > 0) {
      const last = merged[merged.length - 1];
      merged[merged.length - 1] = makeChunk(last.text + ' ' + c.text, last.index);
    } else {
      merged.push({ ...c, index: merged.length });
    }
  }
  return merged;
}

// ─── Exercise generation ──────────────────────────────────────────────────────

/**
 * Build an exercise descriptor for a given chunk at the specified difficulty level.
 * The `weakWords` list influences which words get blanked at levels 2-4.
 */
export function generateExercise(
  chunks: Chunk[],
  activeChunkIndices: number[],
  level: number,
  weakWords: WeakWord[],
): Exercise {
  const chunkTexts = activeChunkIndices.map(i => chunks[i]).filter(Boolean);
  const combinedText = chunkTexts.map(c => c.text).join(' ');
  const words = combinedText.split(/\s+/).filter(Boolean);
  const weakSet = new Set(weakWords.map(w => normalizeForComparison(w.word)));

  const type = levelToExerciseType(level);

  switch (type) {
    case 'study':
      return {
        type,
        chunkIndices: activeChunkIndices,
        promptText: combinedText,
        displayText: combinedText,
      };

    case 'word-bank': {
      const blankPositions = selectBlanks(words, 0.4, weakSet);
      const wordBank = shuffle([...new Set(blankPositions.map(i => normalizeForComparison(words[i])))]);
      return {
        type,
        chunkIndices: activeChunkIndices,
        promptText: '',
        displayText: buildBlankedText(words, blankPositions),
        wordBank,
        blankPositions,
      };
    }

    case 'easy-blanks': {
      const blankPositions = selectBlanks(words, 0.25, weakSet);
      return {
        type,
        chunkIndices: activeChunkIndices,
        promptText: '',
        displayText: buildBlankedText(words, blankPositions),
        blankPositions,
      };
    }

    case 'hard-blanks': {
      const blankPositions = selectBlanks(words, 0.5, weakSet);
      return {
        type,
        chunkIndices: activeChunkIndices,
        promptText: '',
        displayText: buildBlankedText(words, blankPositions),
        blankPositions,
      };
    }

    case 'first-letters':
      return {
        type,
        chunkIndices: activeChunkIndices,
        promptText: '',
        displayText: buildFirstLetterHints(combinedText),
      };

    case 'chunk-recall':
      return {
        type,
        chunkIndices: activeChunkIndices,
        promptText: `Type from memory: chunk ${activeChunkIndices.map(i => i + 1).join('+')}`,
        displayText: '',
      };

    case 'combined-chunks':
      return {
        type,
        chunkIndices: activeChunkIndices,
        promptText: `Type chunks ${activeChunkIndices.map(i => i + 1).join(' + ')} from memory`,
        displayText: '',
      };

    case 'full-recall':
      return {
        type,
        chunkIndices: activeChunkIndices,
        promptText: 'Type the complete verse from memory',
        displayText: '',
      };
  }
}

function levelToExerciseType(level: number): ExerciseType {
  if (level <= 1) return 'study';
  if (level === 2) return 'word-bank';
  if (level === 3) return 'easy-blanks';
  if (level === 4) return 'hard-blanks';
  if (level === 5) return 'first-letters';
  if (level === 6) return 'chunk-recall';
  if (level === 7) return 'combined-chunks';
  return 'full-recall';
}

/** Select word indices to blank, preferring weak words. */
function selectBlanks(words: string[], fraction: number, weakSet: Set<string>): number[] {
  const meaningful = words.map((w, i) => ({ w: normalizeForComparison(w), i }))
    .filter(({ w }) => w.length > 2 && !/^\d+$/.test(w)); // skip short words and pure numbers

  const targetCount = Math.max(1, Math.round(meaningful.length * fraction));

  // Prioritise weak words
  const weak = meaningful.filter(({ w }) => weakSet.has(w));
  const other = shuffle(meaningful.filter(({ w }) => !weakSet.has(w)));

  const selected = [...weak, ...other].slice(0, targetCount);
  return selected.map(x => x.i).sort((a, b) => a - b);
}

function buildBlankedText(words: string[], blankPositions: number[]): string {
  const blankSet = new Set(blankPositions);
  return words.map((w, i) => blankSet.has(i) ? '___' : w).join(' ');
}

function buildFirstLetterHints(text: string): string {
  return text.split(/(\s+)/).map((part, i) => {
    if (i % 2 === 1) return part; // preserve spaces
    if (part.length === 0) return part;
    // First letter + underscores for rest
    return part[0] + '_'.repeat(Math.max(0, part.length - 1));
  }).join('');
}

// ─── Adaptive difficulty ──────────────────────────────────────────────────────

const LEVEL_UP_THRESHOLD   = 2; // consecutive passes to advance
const LEVEL_DOWN_THRESHOLD = 2; // consecutive genuine failures to retreat
const PASS_SCORE           = 0.85;
const STRUGGLE_SCORE       = 0.60; // below this = genuine struggle

/** Given recent performance log, compute the new difficulty level. */
export function adaptLevel(
  currentLevel: number,
  recentLog: PerformanceEntry[],
  maxLevel = 8,
): number {
  if (currentLevel <= 1) {
    const last = recentLog[recentLog.length - 1];
    if (last && last.passed) return 2;
    return 1;
  }

  // Consider only last 5 attempts
  const recent = recentLog.slice(-5);
  if (recent.length < 2) return currentLevel;

  const consecutivePasses = countConsecutiveFromEnd(recent, e => e.passed);
  const consecutiveFailures = countConsecutiveFromEnd(recent, e => !e.passed && e.score < STRUGGLE_SCORE);

  if (consecutivePasses >= LEVEL_UP_THRESHOLD) {
    return Math.min(maxLevel, currentLevel + 1);
  }
  if (consecutiveFailures >= LEVEL_DOWN_THRESHOLD) {
    return Math.max(1, currentLevel - 1);
  }
  return currentLevel;
}

function countConsecutiveFromEnd<T>(arr: T[], pred: (x: T) => boolean): number {
  let count = 0;
  for (let i = arr.length - 1; i >= 0; i--) {
    if (pred(arr[i])) count++;
    else break;
  }
  return count;
}

// ─── Weak word tracking ───────────────────────────────────────────────────────

/** Update the weak-word list based on an attempt result. */
export function updateWeakWords(
  existing: WeakWord[],
  result: AttemptResult,
): WeakWord[] {
  const map = new Map(existing.map(w => [w.word, w.failCount]));

  // Increment fail count for genuinely wrong/missing words
  for (const w of result.missing) {
    const key = normalizeForComparison(w);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  for (const { expected } of result.wrong) {
    const key = normalizeForComparison(expected);
    map.set(key, (map.get(key) ?? 0) + 1);
  }

  // Decrement fail count for words typed correctly
  for (const w of result.correct) {
    const key = normalizeForComparison(w);
    const current = map.get(key) ?? 0;
    if (current > 0) map.set(key, current - 1);
    if (map.get(key) === 0) map.delete(key);
  }

  return [...map.entries()]
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([word, failCount]) => ({ word, failCount }));
}

// ─── Spaced review scheduling ─────────────────────────────────────────────────

export type MasteryLevel = 'learning' | 'bronze' | 'silver' | 'gold' | 'diamond';

/**
 * Compute the next review date and updated interval based on performance.
 * Returns `{nextReviewDate, newIntervalDays}` where nextReviewDate is ISO date.
 */
export function scheduleNextReview(
  score: number,
  currentIntervalDays: number,
  successfulReviews: number,
  totalReviews: number,
): { nextReviewDate: string; newIntervalDays: number } {
  let newInterval: number;

  if (score >= 0.9) {
    // Excellent: grow interval
    newInterval = Math.max(1, Math.round(currentIntervalDays === 0 ? 1 : currentIntervalDays * 2.5));
  } else if (score >= 0.7) {
    // Good: moderate growth
    newInterval = Math.max(1, Math.round(currentIntervalDays === 0 ? 1 : currentIntervalDays * 1.5));
  } else {
    // Struggled: reset to 1 day
    newInterval = 1;
  }

  const date = new Date();
  date.setDate(date.getDate() + newInterval);
  return {
    nextReviewDate: date.toLocaleDateString('en-CA'), // YYYY-MM-DD
    newIntervalDays: newInterval,
  };
}

/**
 * Compute mastery level from review statistics.
 * Diamond requires time — it cannot be earned on day 1.
 */
export function computeMastery(
  successfulReviews: number,
  daysSinceCreated: number,
  maxIntervalSurvived: number,
): MasteryLevel {
  const { diamond, gold, silver, bronze } = MASTERY_THRESHOLDS;
  if (
    successfulReviews >= diamond.minSuccessfulReviews &&
    daysSinceCreated >= diamond.minDaysSinceCreated &&
    maxIntervalSurvived >= diamond.minIntervalDays
  ) return 'diamond';
  if (successfulReviews >= gold.minSuccessfulReviews) return 'gold';
  if (successfulReviews >= silver.minSuccessfulReviews) return 'silver';
  if (successfulReviews >= bronze.minSuccessfulReviews) return 'bronze';
  return 'learning';
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
