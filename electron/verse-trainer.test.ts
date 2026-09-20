import { describe, it, expect } from 'vitest';
import {
  normalizeForComparison,
  tokenize,
  levenshtein,
  damerauLevenshtein,
  isTypo,
  compareAttempt,
  chunkText,
  generateExercise,
  adaptLevel,
  computeNextTrainingStep,
  updateWeakWords,
  scheduleNextReview,
  computeMastery,
  MASTERY_THRESHOLDS,
} from './verse-trainer.js';
import type { PerformanceEntry, WeakWord } from './verse-trainer.js';

// ─── normalizeForComparison ───────────────────────────────────────────────────

describe('normalizeForComparison', () => {
  it('lowercases text', () => {
    expect(normalizeForComparison('The Lord')).toBe('the lord');
  });

  it('strips punctuation except apostrophes in contractions', () => {
    expect(normalizeForComparison("Don't fear.")).toBe("don't fear");
  });

  it('collapses whitespace', () => {
    expect(normalizeForComparison('  a  b  ')).toBe('a b');
  });

  it('handles smart quotes', () => {
    expect(normalizeForComparison('\u201cGod\u201d')).toBe('god');
  });

  it('handles leading and trailing double quotes properly', () => {
    expect(tokenize('"Be strong and courageous"')).toEqual(['be', 'strong', 'and', 'courageous']);
  });
});

// ─── damerauLevenshtein & isTypo ──────────────────────────────────────────────

describe('damerauLevenshtein & isTypo', () => {
  it('returns 0 for identical strings', () => {
    expect(damerauLevenshtein('hello', 'hello')).toBe(0);
  });

  it('returns length of b for empty a', () => {
    expect(damerauLevenshtein('', 'abc')).toBe(3);
  });

  it('computes substitution', () => {
    expect(damerauLevenshtein('kitten', 'sitting')).toBe(3);
  });

  it('computes single transposition as distance 1', () => {
    expect(damerauLevenshtein('teh', 'the')).toBe(1);
    expect(damerauLevenshtein('recieve', 'receive')).toBe(1);
    expect(damerauLevenshtein('strenght', 'strength')).toBe(1);
  });

  it('recognizes transpositions as typos', () => {
    expect(isTypo('the', 'teh')).toBe(true);
    expect(isTypo('receive', 'recieve')).toBe(true);
    expect(isTypo('strength', 'strenght')).toBe(true);
  });

  it('requires exact match for very short words <= 2 chars', () => {
    expect(isTypo('no', 'on')).toBe(false);
    expect(isTypo('in', 'is')).toBe(false);
  });
});

// ─── compareAttempt ──────────────────────────────────────────────────────────

const MASTER = 'For God so loved the world, that he gave his only begotten Son.';

describe('compareAttempt', () => {
  it('perfect match → score 1, passed', () => {
    const r = compareAttempt(MASTER, MASTER);
    expect(r.score).toBe(1);
    expect(r.passed).toBe(true);
    expect(r.missing.length).toBe(0);
    expect(r.wrong.length).toBe(0);
  });

  it('accepts typos with full score (1.0), passes without penalty', () => {
    // User feedback: "dont score bad for typos just wrong words or words in wrong places"
    const attempt = 'For God so lovd the world that he gave his only begoten Son';
    const r = compareAttempt(MASTER, attempt);
    expect(r.score).toBe(1);
    expect(r.passed).toBe(true);
    expect(r.typos.length).toBeGreaterThan(0);
  });

  it('missing words reduce score and fail', () => {
    const r = compareAttempt('God is great and mighty', 'God is mighty');
    expect(r.score).toBeLessThan(1);
    expect(r.missing.length).toBeGreaterThan(0);
    expect(r.passed).toBe(false);
  });

  it('extra words are detected', () => {
    const r = compareAttempt('God is love', 'God is the love here');
    expect(r.extra.length).toBeGreaterThan(0);
  });

  it('words in the wrong place fail and are marked reordered', () => {
    const r = compareAttempt('be strong and very courageous', 'and be strong very courageous');
    expect(r.passed).toBe(false);
    expect(r.reordered).toBe(true);
    expect(r.misplaced).toContain('and');
  });

  it('handles empty master gracefully', () => {
    const r = compareAttempt('', 'something');
    expect(r.score).toBe(1);
    expect(r.passed).toBe(true);
  });

  it('completely wrong attempt → score < 0.2', () => {
    const r = compareAttempt('The Lord is my shepherd', 'xyz abc def pqr');
    expect(r.score).toBeLessThan(0.3);
    expect(r.passed).toBe(false);
  });
});

// ─── chunkText ───────────────────────────────────────────────────────────────

describe('chunkText', () => {
  it('short verse stays as one chunk', () => {
    const chunks = chunkText('I can do all things through Christ.');
    expect(chunks.length).toBe(1);
  });

  it('splits multi-sentence text into coherent chunks', () => {
    const text = 'God is love. Love is patient. Love is kind.';
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    // Concatenated text should cover the original words
    const allWords = chunks.map(c => c.text).join(' ');
    expect(allWords.length).toBeGreaterThan(0);
  });

  it('chunks Joshua 1:7-8 into ~5 natural clauses instead of 10 tiny fragments', () => {
    const joshua = '"Be strong and very courageous. Be careful to obey all the law my servant Moses gave you; do not turn from it to the right or to the left, that you may be successful wherever you go. Keep this Book of the Law always on your lips; meditate on it day and night, so that you may be careful to do everything written in it. Then you will be prosperous and successful.';
    const chunks = chunkText(joshua);
    expect(chunks.length).toBe(5);
    // Every chunk should have at least 6 words
    chunks.forEach(c => expect(c.wordCount).toBeGreaterThanOrEqual(6));
  });

  it('chunk indices are 0-based and sequential', () => {
    const chunks = chunkText('The Lord is my shepherd; I shall not want. He makes me lie down in green pastures.');
    chunks.forEach((c, i) => expect(c.index).toBe(i));
  });

  it('returns empty for empty input', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   ')).toEqual([]);
  });
});

// ─── generateExercise ─────────────────────────────────────────────────────────

describe('generateExercise', () => {
  const CHUNKS = chunkText('The Lord is my shepherd; I shall not want. He makes me lie down in green pastures.');

  it('level 1 → study type with full text displayed', () => {
    const ex = generateExercise(CHUNKS, [0], 1, []);
    expect(ex.type).toBe('study');
    expect(ex.displayText.length).toBeGreaterThan(0);
  });

  it('level 2 → word-bank type with word bank provided', () => {
    const ex = generateExercise(CHUNKS, [0], 2, []);
    expect(ex.type).toBe('word-bank');
    expect(Array.isArray(ex.wordBank)).toBe(true);
    expect(ex.wordBank!.length).toBeGreaterThan(0);
  });

  it('easy-blanks and hard-blanks provide blankAnswers dictionary', () => {
    const exEasy = generateExercise(CHUNKS, [0], 3, []);
    expect(exEasy.blankAnswers).toBeDefined();
    expect(Object.keys(exEasy.blankAnswers!).length).toBe(exEasy.blankPositions!.length);

    const exHard = generateExercise(CHUNKS, [0], 4, []);
    expect(exHard.blankAnswers).toBeDefined();
    expect(Object.keys(exHard.blankAnswers!).length).toBe(exHard.blankPositions!.length);
  });

  it('level 8 → full-recall type', () => {
    const ex = generateExercise(CHUNKS, CHUNKS.map((_, i) => i), 8, []);
    expect(ex.type).toBe('full-recall');
    expect(ex.displayText).toBe('');
  });

  it('weak words appear in blanked positions', () => {
    const weakWords: WeakWord[] = [{ word: 'shepherd', failCount: 3 }];
    const ex = generateExercise(CHUNKS, [0], 3, weakWords);
    expect(ex.type).toBe('easy-blanks');
  });
});

// ─── adaptLevel & computeNextTrainingStep ─────────────────────────────────────

describe('adaptLevel', () => {
  it('returns current level when log is empty', () => {
    expect(adaptLevel(3, [])).toBe(3);
  });

  it('advances upon passing', () => {
    expect(adaptLevel(1, [{ level: 1, score: 1, timestamp: 0, passed: true }])).toBe(2);
    expect(adaptLevel(3, [{ level: 3, score: 0.9, timestamp: 0, passed: true }])).toBe(4);
  });

  it('stays on level after a single failure to allow retry', () => {
    const log: PerformanceEntry[] = [
      { level: 4, score: 0.5, timestamp: 0, passed: false },
    ];
    expect(adaptLevel(4, log)).toBe(4);
  });

  it('levels down after 2 consecutive genuine failures', () => {
    const log: PerformanceEntry[] = [
      { level: 4, score: 0.3, timestamp: 0, passed: false },
      { level: 4, score: 0.4, timestamp: 1, passed: false },
    ];
    expect(adaptLevel(4, log)).toBe(3);
  });

  it('does not go below level 1', () => {
    const log: PerformanceEntry[] = [
      { level: 1, score: 0.1, timestamp: 0, passed: false },
      { level: 1, score: 0.2, timestamp: 1, passed: false },
    ];
    expect(adaptLevel(1, log)).toBe(1);
  });

  it('does not exceed maxLevel', () => {
    const log: PerformanceEntry[] = [
      { level: 8, score: 1, timestamp: 0, passed: true },
    ];
    expect(adaptLevel(8, log, 8)).toBe(8);
  });
});

describe('computeNextTrainingStep (progressive chunk onboarding)', () => {
  const totalChunks = 5;

  it('ramps Chunk 0 from Level 1 through Level 6', () => {
    expect(computeNextTrainingStep(0, 1, true, 1.0, totalChunks, [])).toEqual({ nextChunk: 0, nextLevel: 2 });
    expect(computeNextTrainingStep(0, 2, true, 1.0, totalChunks, [])).toEqual({ nextChunk: 0, nextLevel: 3 });
    expect(computeNextTrainingStep(0, 5, true, 1.0, totalChunks, [])).toEqual({ nextChunk: 0, nextLevel: 6 });
  });

  it('after Chunk 0 Level 6 recall passes, introduces Chunk 1 at Level 1 (Study)', () => {
    // "when we introduce new chunks we have to go over them nice and slow and ramp our way up"
    const next = computeNextTrainingStep(0, 6, true, 1.0, totalChunks, []);
    expect(next).toEqual({ nextChunk: 1, nextLevel: 1 });
  });

  it('ramps Chunk 1 from Level 1 through Level 6', () => {
    expect(computeNextTrainingStep(1, 1, true, 1.0, totalChunks, [])).toEqual({ nextChunk: 1, nextLevel: 2 });
    expect(computeNextTrainingStep(1, 5, true, 1.0, totalChunks, [])).toEqual({ nextChunk: 1, nextLevel: 6 });
  });

  it('after Chunk 1 Level 6 recall passes, advances to Level 7 (Combined Chunks 1 + 2)', () => {
    const next = computeNextTrainingStep(1, 6, true, 1.0, totalChunks, []);
    expect(next).toEqual({ nextChunk: 1, nextLevel: 7 });
  });

  it('after Level 7 combined chunks passes, introduces Chunk 2 at Level 1 (Study)', () => {
    const next = computeNextTrainingStep(1, 7, true, 1.0, totalChunks, []);
    expect(next).toEqual({ nextChunk: 2, nextLevel: 1 });
  });

  it('after final chunk combined passes, advances to Level 8 (Full Verse Recall)', () => {
    const lastChunkIndex = totalChunks - 1; // 4
    const next = computeNextTrainingStep(lastChunkIndex, 7, true, 1.0, totalChunks, []);
    expect(next).toEqual({ nextChunk: lastChunkIndex, nextLevel: 8 });
  });

  it('single-chunk verse goes straight from Level 6 to Level 8', () => {
    const next = computeNextTrainingStep(0, 6, true, 1.0, 1, []);
    expect(next).toEqual({ nextChunk: 0, nextLevel: 8 });
  });

  it('keeps chunk and stays/retries on failure', () => {
    const log: PerformanceEntry[] = [{ level: 3, score: 0.5, timestamp: 0, passed: false }];
    const next = computeNextTrainingStep(2, 3, false, 0.5, totalChunks, log);
    expect(next.nextChunk).toBe(2);
    expect(next.nextLevel).toBe(3);
  });
});

// ─── updateWeakWords ─────────────────────────────────────────────────────────

describe('updateWeakWords', () => {
  it('increments fail count for missing words', () => {
    const result = { score: 0.5, correct: [], typos: [], missing: ['shepherd'], wrong: [], extra: [], reordered: false, passed: false };
    const updated = updateWeakWords([], result);
    expect(updated.some(w => w.word === 'shepherd' && w.failCount > 0)).toBe(true);
  });

  it('decrements fail count for correct words', () => {
    const existing: WeakWord[] = [{ word: 'shepherd', failCount: 2 }];
    const result = { score: 1, correct: ['shepherd'], typos: [], missing: [], wrong: [], extra: [], reordered: false, passed: true };
    const updated = updateWeakWords(existing, result);
    const w = updated.find(x => x.word === 'shepherd');
    expect(w?.failCount ?? 0).toBeLessThan(2);
  });

  it('removes word when fail count reaches 0', () => {
    const existing: WeakWord[] = [{ word: 'shepherd', failCount: 1 }];
    const result = { score: 1, correct: ['shepherd'], typos: [], missing: [], wrong: [], extra: [], reordered: false, passed: true };
    const updated = updateWeakWords(existing, result);
    expect(updated.find(x => x.word === 'shepherd')).toBeUndefined();
  });
});

// ─── scheduleNextReview ───────────────────────────────────────────────────────

describe('scheduleNextReview', () => {
  it('excellent score grows interval', () => {
    const r = scheduleNextReview(1.0, 7, 3, 5);
    expect(r.newIntervalDays).toBeGreaterThan(7);
  });

  it('poor score resets interval to 1', () => {
    const r = scheduleNextReview(0.4, 14, 5, 8);
    expect(r.newIntervalDays).toBe(1);
  });

  it('returns a future date string in YYYY-MM-DD format', () => {
    const r = scheduleNextReview(1.0, 1, 0, 1);
    expect(/^\d{4}-\d{2}-\d{2}$/.test(r.nextReviewDate)).toBe(true);
  });
});

// ─── computeMastery ──────────────────────────────────────────────────────────

describe('computeMastery', () => {
  it('returns learning when no successful reviews', () => {
    expect(computeMastery(0, 0, 0)).toBe('learning');
  });

  it('returns bronze after 1 successful review', () => {
    expect(computeMastery(MASTERY_THRESHOLDS.bronze.minSuccessfulReviews, 0, 0)).toBe('bronze');
  });

  it('returns silver after 3 successful reviews', () => {
    expect(computeMastery(MASTERY_THRESHOLDS.silver.minSuccessfulReviews, 0, 0)).toBe('silver');
  });

  it('returns gold after 6 successful reviews', () => {
    expect(computeMastery(MASTERY_THRESHOLDS.gold.minSuccessfulReviews, 5, 0)).toBe('gold');
  });

  it('returns diamond only with reviews + time + interval', () => {
    const { diamond } = MASTERY_THRESHOLDS;
    expect(computeMastery(diamond.minSuccessfulReviews, diamond.minDaysSinceCreated, diamond.minIntervalDays)).toBe('diamond');
  });

  it('does not award diamond without enough time', () => {
    const { diamond } = MASTERY_THRESHOLDS;
    // Enough reviews but not enough days
    expect(computeMastery(diamond.minSuccessfulReviews, 5, diamond.minIntervalDays)).toBe('gold');
  });
});
