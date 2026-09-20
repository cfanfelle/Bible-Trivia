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
  blankAnswers?: Record<number, string>; // word index -> expected word
}

export interface AttemptResult {
  score: number;               // 0.0–1.0
  correct: string[];
  typos: { word: string; typed: string }[];
  missing: string[];
  wrong: { expected: string; typed: string }[];
  extra: string[];
  misplaced?: string[];
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
    .replace(/'\s/g, ' ')        // trailing apostrophes before space
    .replace(/\s'/g, ' ')        // leading apostrophes after space
    .replace(/^'+|'+$/g, '')     // leading or trailing apostrophes at text boundaries
    .replace(/\s+/g, ' ')
    .trim();
}

/** Split normalised text into word tokens, stripping any leading/trailing quotes from tokens. */
export function tokenize(text: string): string[] {
  return normalizeForComparison(text)
    .split(' ')
    .map(w => w.replace(/^'+|'+$/g, ''))
    .filter(Boolean);
}

// ─── Damerau-Levenshtein distance ─────────────────────────────────────────────

export function damerauLevenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,        // deletion
        dp[i][j - 1] + 1,        // insertion
        dp[i - 1][j - 1] + cost  // substitution
      );
      // Adjacent character transposition (e.g. "recieve" -> "receive", "strenght" -> "strength")
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
      }
    }
  }
  return dp[m][n];
}

/** Keep levenshtein as an alias for backward compatibility. */
export function levenshtein(a: string, b: string): number {
  return damerauLevenshtein(a, b);
}

/** Returns true if the typed word is a likely typo of the expected word. */
export function isTypo(expected: string, typed: string): boolean {
  if (expected === typed) return false;
  if (expected.length <= 2) return false;           // short words (in, to, of, no, be) need exact match
  const dist = damerauLevenshtein(expected, typed);
  if (dist === 0) return false;
  const maxLen = Math.max(expected.length, typed.length);
  // 3-4 chars: allow 1 edit (e.g. teh -> the, god -> gdo)
  if (maxLen <= 4) return dist === 1;
  // 5-7 chars: allow up to 2 edits (e.g. transposition, or 1 transposition + 1 slip)
  if (maxLen <= 7) return dist <= 2;
  // 8+ chars: allow up to 3 edits or ~35% of length
  return dist <= Math.max(2, Math.floor(maxLen * 0.35));
}

// ─── Attempt comparison ───────────────────────────────────────────────────────

/**
 * Compare the user's typed attempt against the master text.
 * Handles normalisation, typo detection, missing/extra/wrong words, and misplaced words.
 *
 * NOTE: User feedback: "dont score bad for typos just wrong words or words in wrong places"
 * Typos receive full credit towards the score and do not fail the attempt.
 */
export function compareAttempt(masterText: string, attempt: string): AttemptResult {
  const expected = tokenize(masterText);
  const typed    = tokenize(attempt);

  if (expected.length === 0) {
    return { score: 1, correct: [], typos: [], missing: [], wrong: [], extra: [], misplaced: [], reordered: false, passed: true };
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

  // Detect words placed in the wrong position (misplaced words)
  const misplaced: string[] = [];
  const missingSet = new Set(missing);
  for (const ew of extra) {
    if (missingSet.has(ew)) {
      misplaced.push(ew);
      reordered = true;
    }
  }

  // Score: typos receive FULL credit (1.0).
  // Deduct for genuinely wrong words and extra words.
  const numerator = correct.length + typos.length;
  const penalty = wrong.length * 0.5 + extra.length * 0.25;
  const score = Math.max(0, Math.min(1, (numerator - penalty) / expected.length));

  // Pass threshold: score >= 0.85 and no missing words, no wrong words, no misplaced words.
  const passed = score >= 0.85 && missing.length === 0 && wrong.length === 0 && !reordered;

  return { score, correct, typos, missing, wrong, extra, misplaced, reordered, passed };
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

const TARGET_MAX_WORDS = 24;  // Natural max words in a single chunk
const TARGET_MIN_WORDS = 6;   // Min words in a chunk (prevents chopped fragments)

/**
 * Split masterText into learnable, grammatically coherent chunks.
 * Hierarchy: complete sentences > semicolons/colons > major comma groups > conjunctions.
 * Avoids breaking verses into tiny chopped-up phrases.
 */
export function chunkText(masterText: string): Chunk[] {
  const raw = masterText.trim();
  if (!raw) return [];

  // Split on sentence boundaries first: [.!?] followed by whitespace
  const rawSentences = raw.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
  const rawChunks: string[] = [];

  for (const sentence of rawSentences) {
    const sWords = sentence.split(/\s+/).filter(Boolean);
    if (sWords.length <= TARGET_MAX_WORDS) {
      rawChunks.push(sentence);
    } else {
      // Sentence is long (> 24 words). Try splitting on clause boundaries (semicolons, colons, em-dashes)
      const clauses = sentence.split(/(?<=[;:—])\s+/).map(c => c.trim()).filter(Boolean);
      if (clauses.length > 1) {
        for (const clause of clauses) {
          const cWords = clause.split(/\s+/).filter(Boolean);
          if (cWords.length <= TARGET_MAX_WORDS) {
            rawChunks.push(clause);
          } else {
            // Clause is still long: group by commas if present
            splitOnCommaGroups(clause, TARGET_MAX_WORDS, rawChunks);
          }
        }
      } else {
        // Sentence has no semicolons/colons: try commas
        splitOnCommaGroups(sentence, TARGET_MAX_WORDS, rawChunks);
      }
    }
  }

  // Merge tiny fragments (< TARGET_MIN_WORDS) with a neighbor so no fragment is a stranded phrase
  const merged: string[] = [];
  for (let i = 0; i < rawChunks.length; i++) {
    const chunk = rawChunks[i];
    const wCount = chunk.split(/\s+/).filter(Boolean).length;
    if (wCount < TARGET_MIN_WORDS && merged.length > 0) {
      const prev = merged[merged.length - 1];
      const prevCount = prev.split(/\s+/).filter(Boolean).length;
      if (prevCount + wCount <= TARGET_MAX_WORDS + 4) {
        merged[merged.length - 1] = prev + ' ' + chunk;
        continue;
      }
    }
    merged.push(chunk);
  }

  // Also check if the very first chunk was too small and can merge forward
  if (merged.length > 1) {
    const firstCount = merged[0].split(/\s+/).filter(Boolean).length;
    const secondCount = merged[1].split(/\s+/).filter(Boolean).length;
    if (firstCount < TARGET_MIN_WORDS && firstCount + secondCount <= TARGET_MAX_WORDS + 4) {
      const first = merged.shift()!;
      merged[0] = first + ' ' + merged[0];
    }
  }

  return merged.map((text, index) => ({
    index,
    text,
    wordCount: text.split(/\s+/).filter(Boolean).length,
  }));
}

function splitOnCommaGroups(text: string, maxWords: number, out: string[]): void {
  const commaParts = text.split(/(?<=,)\s+/).map(p => p.trim()).filter(Boolean);
  if (commaParts.length <= 1) {
    const conjSplit = splitOnConjunction(text, maxWords);
    if (conjSplit) {
      out.push(...conjSplit);
    } else {
      out.push(text);
    }
    return;
  }

  let cur = '';
  for (const part of commaParts) {
    if (!cur) {
      cur = part;
    } else {
      const combinedCount = (cur + ' ' + part).split(/\s+/).filter(Boolean).length;
      if (combinedCount <= maxWords) {
        cur += ' ' + part;
      } else {
        out.push(cur);
        cur = part;
      }
    }
  }
  if (cur) out.push(cur);
}

function splitOnConjunction(text: string, maxWords: number): string[] | null {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return null;
  const mid = Math.floor(words.length / 2);
  const conjRegex = /^(and|but|or|for|so|that|because)$/i;
  for (let offset = 0; offset <= 4; offset++) {
    for (const idx of [mid + offset, mid - offset]) {
      if (idx > 2 && idx < words.length - 2 && conjRegex.test(words[idx])) {
        return [
          words.slice(0, idx).join(' '),
          words.slice(idx).join(' '),
        ];
      }
    }
  }
  return [
    words.slice(0, mid).join(' '),
    words.slice(mid).join(' '),
  ];
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
        promptText: chunks.length > 1
          ? `Read and study Chunk ${activeChunkIndices[0] + 1} of ${chunks.length}. Press Continue when you feel familiar with it.`
          : 'Read and study this passage. Press Continue when you feel familiar with it.',
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
      const blankAnswers: Record<number, string> = {};
      for (const pos of blankPositions) blankAnswers[pos] = words[pos];
      return {
        type,
        chunkIndices: activeChunkIndices,
        promptText: '',
        displayText: buildBlankedText(words, blankPositions),
        blankPositions,
        blankAnswers,
      };
    }

    case 'hard-blanks': {
      const blankPositions = selectBlanks(words, 0.5, weakSet);
      const blankAnswers: Record<number, string> = {};
      for (const pos of blankPositions) blankAnswers[pos] = words[pos];
      return {
        type,
        chunkIndices: activeChunkIndices,
        promptText: '',
        displayText: buildBlankedText(words, blankPositions),
        blankPositions,
        blankAnswers,
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
        promptText: `Type chunk ${activeChunkIndices[0] + 1} from memory`,
        displayText: '',
      };

    case 'combined-chunks': {
      const first = activeChunkIndices[0] + 1;
      const last = activeChunkIndices[activeChunkIndices.length - 1] + 1;
      const rangeStr = activeChunkIndices.length === 2 ? `${first} + ${last}` : `${first} through ${last}`;
      return {
        type,
        chunkIndices: activeChunkIndices,
        promptText: `Type chunks ${rangeStr} from memory`,
        displayText: '',
      };
    }

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

// ─── Adaptive difficulty & chunk progression ─────────────────────────────────

const LEVEL_UP_THRESHOLD   = 1; // 1 solid pass (>= 0.85) to advance
const LEVEL_DOWN_THRESHOLD = 2; // consecutive genuine failures to retreat
const PASS_SCORE           = 0.85;
const STRUGGLE_SCORE       = 0.60; // below this = genuine struggle

/** Given recent performance log, compute the new difficulty level. */
export function adaptLevel(
  currentLevel: number,
  recentLog: PerformanceEntry[],
  maxLevel = 8,
): number {
  if (recentLog.length === 0) return currentLevel;
  const last = recentLog[recentLog.length - 1];

  if (last.passed) {
    return Math.min(maxLevel, currentLevel + 1);
  }

  // If failed: check for repeated struggles to step down
  const recent = recentLog.slice(-4);
  const consecutiveFailures = countConsecutiveFromEnd(recent, e => !e.passed && e.score < STRUGGLE_SCORE);

  if (consecutiveFailures >= LEVEL_DOWN_THRESHOLD) {
    return Math.max(1, currentLevel - 1);
  }

  return currentLevel;
}

/**
 * Compute the next chunk and difficulty level following an attempt.
 * Ensures each chunk is introduced and scaffolded from Study (Level 1)
 * before being recalled or combined.
 */
export function computeNextTrainingStep(
  currentChunk: number,
  currentLevel: number,
  passed: boolean,
  score: number,
  totalChunks: number,
  recentLog: PerformanceEntry[],
): { nextChunk: number; nextLevel: number } {
  if (!passed) {
    // If not passed: stay on current chunk, adapt level (retry or step down if struggling)
    return {
      nextChunk: currentChunk,
      nextLevel: adaptLevel(currentLevel, recentLog),
    };
  }

  // Attempt passed!
  if (currentLevel < 6) {
    // Ramping up through chunk stages (1 Study -> 2 Word bank -> 3 Easy blanks -> 4 Hard blanks -> 5 First letters -> 6 Recall)
    return {
      nextChunk: currentChunk,
      nextLevel: currentLevel + 1,
    };
  }

  if (currentLevel === 6) {
    // Mastered chunk recall for this chunk!
    if (totalChunks <= 1) {
      // Single-chunk verse goes straight to full recall
      return { nextChunk: 0, nextLevel: 8 };
    }
    if (currentChunk === 0) {
      // Chunk 0 is mastered! Now introduce Chunk 1 "nice and slow and ramp our way up"
      return { nextChunk: 1, nextLevel: 1 };
    }
    // For Chunk 1 and beyond, now combine all chunks learned so far (0..currentChunk)
    return { nextChunk: currentChunk, nextLevel: 7 };
  }

  if (currentLevel === 7) {
    // Mastered combined chunks up through currentChunk!
    if (currentChunk < totalChunks - 1) {
      // Advance to the next new chunk and start at Level 1 (Study) to ramp up
      return { nextChunk: currentChunk + 1, nextLevel: 1 };
    }
    // All chunks have been learned and combined! Move to Full Verse Recall
    return { nextChunk: currentChunk, nextLevel: 8 };
  }

  // Level 8 (Full Verse Recall) passed!
  return { nextChunk: currentChunk, nextLevel: 8 };
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
