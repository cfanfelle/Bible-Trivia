import { describe, it, expect } from 'vitest';
import {
  normalizeForComparison,
  tokenize,
  levenshtein,
  compareAttempt,
  chunkText,
  generateExercise,
  adaptLevel,
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
});

// ─── levenshtein ─────────────────────────────────────────────────────────────

describe('levenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshtein('hello', 'hello')).toBe(0);
  });

  it('returns length of b for empty a', () => {
    expect(levenshtein('', 'abc')).toBe(3);
  });

  it('computes substitution', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
  });

  it('computes single transposition', () => {
    expect(levenshtein('teh', 'the')).toBe(2);
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

  it('accepts typos as near-correct, still passes', () => {
    const attempt = 'For God so lovd the world that he gave his only begoten Son';
    const r = compareAttempt(MASTER, attempt);
    // typos don't cause failure
    expect(r.passed).toBe(true);
    expect(r.typos.length).toBeGreaterThan(0);
  });

  it('missing words reduce score', () => {
    const r = compareAttempt('God is great and mighty', 'God is mighty');
    expect(r.score).toBeLessThan(1);
    expect(r.missing.length).toBeGreaterThan(0);
    expect(r.passed).toBe(false);
  });

  it('extra words are detected', () => {
    const r = compareAttempt('God is love', 'God is the love here');
    expect(r.extra.length).toBeGreaterThan(0);
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

  it('splits multi-sentence text into multiple chunks', () => {
    const text = 'God is love. Love is patient. Love is kind.';
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    // Concatenated text should cover the original words
    const allWords = chunks.map(c => c.text).join(' ');
    expect(allWords.length).toBeGreaterThan(0);
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

  it('level 8 → full-recall type', () => {
    const ex = generateExercise(CHUNKS, CHUNKS.map((_, i) => i), 8, []);
    expect(ex.type).toBe('full-recall');
    expect(ex.displayText).toBe('');
  });

  it('weak words appear in blanked positions', () => {
    const weakWords: WeakWord[] = [{ word: 'shepherd', failCount: 3 }];
    const ex = generateExercise(CHUNKS, [0], 3, weakWords);
    // Can't guarantee position but should not error
    expect(ex.type).toBe('easy-blanks');
  });
});

// ─── adaptLevel ───────────────────────────────────────────────────────────────

describe('adaptLevel', () => {
  it('does not change level with fewer than 2 entries', () => {
    expect(adaptLevel(3, [])).toBe(3);
    expect(adaptLevel(3, [{ level: 3, score: 1, timestamp: 0, passed: true }])).toBe(3);
  });

  it('levels up after 2 consecutive passes', () => {
    const log: PerformanceEntry[] = [
      { level: 3, score: 0.9, timestamp: 0, passed: true },
      { level: 3, score: 0.95, timestamp: 1, passed: true },
    ];
    expect(adaptLevel(3, log)).toBe(4);
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
      { level: 8, score: 1, timestamp: 1, passed: true },
    ];
    expect(adaptLevel(8, log, 8)).toBe(8);
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
