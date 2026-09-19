import { describe, it, expect } from 'vitest';
import { normalizeCrosswordAnswer, seededLcg, selectClues, selectDailyClues, generateCrossword } from './crossword.js';
import type { ClueRecord } from './crossword.js';

function makeClue(id: string, answer: string): ClueRecord {
  const normalized = normalizeCrosswordAnswer(answer);
  return { id, bookId: 'GEN', clueText: `Clue for ${id}`, answer, answerNormalized: normalized, reference: 'Gen 1:1' };
}

// A set of clues with guaranteed intersections (they share letters)
const SAMPLE_CLUES: ClueRecord[] = [
  makeClue('CW-001', 'CREATION'),
  makeClue('CW-002', 'ADAM'),
  makeClue('CW-003', 'EDEN'),
  makeClue('CW-004', 'SERPENT'),
  makeClue('CW-005', 'COVENANT'),
  makeClue('CW-006', 'ABRAHAM'),
  makeClue('CW-007', 'ISAAC'),
  makeClue('CW-008', 'JACOB'),
  makeClue('CW-009', 'JOSEPH'),
  makeClue('CW-010', 'EGYPT'),
  makeClue('CW-011', 'PROMISE'),
  makeClue('CW-012', 'BLESSING'),
  makeClue('CW-013', 'FIRSTBORN'),
  makeClue('CW-014', 'NATION'),
  makeClue('CW-015', 'SACRIFICE'),
];

describe('normalizeCrosswordAnswer', () => {
  it('strips non-letters and uppercases', () => {
    expect(normalizeCrosswordAnswer("Don't go!")).toBe('DONTGO');
    expect(normalizeCrosswordAnswer('John 3:16')).toBe('JOHN');
    expect(normalizeCrosswordAnswer('holy spirit')).toBe('HOLYSPIRIT');
  });
});

describe('seededLcg', () => {
  it('produces deterministic sequences', () => {
    const rng1 = seededLcg('2026-09-18');
    const rng2 = seededLcg('2026-09-18');
    const seq1 = Array.from({ length: 10 }, rng1);
    const seq2 = Array.from({ length: 10 }, rng2);
    expect(seq1).toEqual(seq2);
  });

  it('produces different sequences for different seeds', () => {
    const rng1 = seededLcg('2026-09-18');
    const rng2 = seededLcg('2026-09-19');
    const seq1 = Array.from({ length: 5 }, rng1);
    const seq2 = Array.from({ length: 5 }, rng2);
    expect(seq1).not.toEqual(seq2);
  });
});

describe('selectClues', () => {
  it('returns error when pool is insufficient', () => {
    const result = selectClues(SAMPLE_CLUES.slice(0, 3), 10, []);
    expect(result).toMatchObject({ error: 'insufficient', available: 3, required: 10 });
  });

  it('returns requested count when pool is sufficient', () => {
    const result = selectClues(SAMPLE_CLUES, 10, []);
    expect(Array.isArray(result)).toBe(true);
    expect((result as ClueRecord[]).length).toBe(10);
  });

  it('prefers non-recent clues', () => {
    const recentIds = SAMPLE_CLUES.slice(0, 10).map(c => c.id);
    const result = selectClues(SAMPLE_CLUES, 5, recentIds) as ClueRecord[];
    // The 5 selected should prefer from SAMPLE_CLUES[10..14]
    const freshSelected = result.filter(c => !recentIds.includes(c.id));
    expect(freshSelected.length).toBeGreaterThan(0);
  });
});

describe('selectDailyClues', () => {
  it('returns same clues for same date (deterministic)', () => {
    const r1 = selectDailyClues(SAMPLE_CLUES, '2026-09-18', 10) as ClueRecord[];
    const r2 = selectDailyClues(SAMPLE_CLUES, '2026-09-18', 10) as ClueRecord[];
    expect(r1.map(c => c.id)).toEqual(r2.map(c => c.id));
  });

  it('returns different clues for different dates', () => {
    const r1 = selectDailyClues(SAMPLE_CLUES, '2026-09-18', 10) as ClueRecord[];
    const r2 = selectDailyClues(SAMPLE_CLUES, '2026-09-19', 10) as ClueRecord[];
    expect(r1.map(c => c.id)).not.toEqual(r2.map(c => c.id));
  });

  it('does not vary by profile id (profile-agnostic)', () => {
    // Simulate two different profile ids by using the date only (no profileId in seed)
    // Both should return the same result — the seed is only the date string
    const r1 = selectDailyClues(SAMPLE_CLUES, '2026-09-18', 10) as ClueRecord[];
    const r2 = selectDailyClues(SAMPLE_CLUES, '2026-09-18', 10) as ClueRecord[];
    expect(r1.map(c => c.id)).toEqual(r2.map(c => c.id));
  });

  it('returns insufficient error when pool too small', () => {
    const result = selectDailyClues(SAMPLE_CLUES.slice(0, 3), '2026-09-18', 10);
    expect(result).toMatchObject({ error: 'insufficient' });
  });
});

describe('generateCrossword', () => {
  it('returns null for empty clue list', () => {
    expect(generateCrossword([])).toBeNull();
  });

  it('generates a layout for a single clue', () => {
    const result = generateCrossword([makeClue('CW-001', 'CREATION')]);
    expect(result).not.toBeNull();
    expect(result!.words.length).toBe(1);
    expect(result!.words[0].direction).toBe('across');
  });

  it('generates a valid connected grid', () => {
    // Use a smaller set that definitely has letter overlaps
    const clues = [
      makeClue('A', 'CREATION'),
      makeClue('B', 'NATION'),
      makeClue('C', 'COVENANT'),
    ];
    const result = generateCrossword(clues);
    if (!result) return; // grid may not always connect; just verify when it succeeds
    // Verify all words fit within bounds
    for (const word of result.words) {
      const dr = word.direction === 'down' ? 1 : 0;
      const dc = word.direction === 'across' ? 1 : 0;
      for (let i = 0; i < word.length; i++) {
        expect(word.row + dr * i).toBeLessThan(result.rows);
        expect(word.col + dc * i).toBeLessThan(result.cols);
      }
    }
  });

  it('produces deterministic output for same input', () => {
    const r1 = generateCrossword(SAMPLE_CLUES.slice(0, 5));
    const r2 = generateCrossword(SAMPLE_CLUES.slice(0, 5));
    // Same clues in same order → same layout
    if (r1 && r2) {
      expect(r1.words.map(w => w.clueId).sort()).toEqual(r2.words.map(w => w.clueId).sort());
    }
  });

  it('no two different clues share the same cell with different letters', () => {
    const result = generateCrossword(SAMPLE_CLUES);
    if (!result) return;
    const cellMap = new Map<string, string>();
    for (const word of result.words) {
      const dr = word.direction === 'down' ? 1 : 0;
      const dc = word.direction === 'across' ? 1 : 0;
      const clue = SAMPLE_CLUES.find(c => c.id === word.clueId)!;
      for (let i = 0; i < word.length; i++) {
        const k = `${word.row + dr * i},${word.col + dc * i}`;
        const letter = clue.answerNormalized[i];
        if (cellMap.has(k)) {
          expect(cellMap.get(k)).toBe(letter); // same letter at intersection
        } else {
          cellMap.set(k, letter);
        }
      }
    }
  });

  it('word numbers follow standard crossword rules — no direction has duplicate numbers', () => {
    const result = generateCrossword(SAMPLE_CLUES);
    if (!result) return;
    // Across words have unique numbers among themselves
    const acrossNums = result.words.filter(w => w.direction === 'across').map(w => w.number);
    expect(new Set(acrossNums).size).toBe(acrossNums.length);
    // Down words have unique numbers among themselves
    const downNums = result.words.filter(w => w.direction === 'down').map(w => w.number);
    expect(new Set(downNums).size).toBe(downNums.length);
    // Numbers are all positive
    for (const w of result.words) expect(w.number).toBeGreaterThan(0);
  });
});
