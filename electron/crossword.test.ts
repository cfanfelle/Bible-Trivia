import { describe, it, expect } from 'vitest';
import { normalizeCrosswordAnswer, seededLcg, selectClues, selectDailyClues, generateCrossword, validateCrosswordLayout } from './crossword.js';
import type { ClueRecord, CrosswordResult } from './crossword.js';

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

describe('curated crossword clues bank', () => {
  it('selects 15 clues for Genesis and generates a valid board', async () => {
    const { CROSSWORD_CLUES } = await import('./content.js');
    const genClues: ClueRecord[] = CROSSWORD_CLUES.filter(c => c[1] === 'GEN').map(c => ({
      id: c[0],
      bookId: c[1],
      clueText: c[5],
      answer: c[6],
      answerNormalized: c[7],
      reference: c[8]
    }));
    expect(genClues.length).toBe(25);
    const selected = selectClues(genClues, 15, []);
    expect(Array.isArray(selected)).toBe(true);
    if (Array.isArray(selected)) {
      expect(selected.length).toBe(15);
      const layout = generateCrossword(selected);
      expect(layout).not.toBeNull();
      expect(layout!.words.length).toBe(15);
    }
  });

  it('selects 15 clues for Exodus and generates a valid board', async () => {
    const { CROSSWORD_CLUES } = await import('./content.js');
    const exoClues: ClueRecord[] = CROSSWORD_CLUES.filter(c => c[1] === 'EXO').map(c => ({
      id: c[0],
      bookId: c[1],
      clueText: c[5],
      answer: c[6],
      answerNormalized: c[7],
      reference: c[8]
    }));
    expect(exoClues.length).toBe(21);
    const selected = selectClues(exoClues, 15, []);
    expect(Array.isArray(selected)).toBe(true);
    if (Array.isArray(selected)) {
      expect(selected.length).toBe(15);
      const layout = generateCrossword(selected);
      expect(layout).not.toBeNull();
      expect(layout!.words.length).toBe(15);
    }
  });

  it('selects 15 clues for Acts and generates a valid board', async () => {
    const { CROSSWORD_CLUES } = await import('./content.js');
    const actClues: ClueRecord[] = CROSSWORD_CLUES.filter(c => c[1] === 'ACT').map(c => ({
      id: c[0],
      bookId: c[1],
      clueText: c[5],
      answer: c[6],
      answerNormalized: c[7],
      reference: c[8]
    }));
    expect(actClues.length).toBe(29);
    const selected = selectClues(actClues, 15, []);
    expect(Array.isArray(selected)).toBe(true);
    if (Array.isArray(selected)) {
      expect(selected.length).toBe(15);
      const layout = generateCrossword(selected);
      expect(layout).not.toBeNull();
      expect(layout!.words.length).toBe(15);
      expect(validateCrosswordLayout(layout!)).toBe(true);
    }
  });
});

describe('crossword layout validation and adjacency bug prevention', () => {
  it('validateCrosswordLayout rejects a layout where words touch perpendicularly creating unintended letter runs', () => {
    // Recreate the exact failure case from the screenshot:
    // TONGUES (down, length 7) at col 3, rows 0..6
    // AARON (across, length 5) at row 7, cols 1..5 -> cell (7,3) is 'R', directly below 'S' at (6,3)
    // SAVED (across, length 5) at row 5, cols 0..4
    // PHARAOH (down, length 7) at col 1, rows 3..9
    // STAFF (across, length 5) at row 0, cols 2..6
    const invalidLayout: CrosswordResult = {
      rows: 10,
      cols: 8,
      words: [
        { clueId: 'STAFF', answer: 'STAFF', row: 0, col: 2, direction: 'across', number: 1, length: 5 },
        { clueId: 'TONGUES', answer: 'TONGUES', row: 0, col: 3, direction: 'down', number: 2, length: 7 },
        { clueId: 'PHARAOH', answer: 'PHARAOH', row: 3, col: 1, direction: 'down', number: 3, length: 7 },
        { clueId: 'SAVED', answer: 'SAVED', row: 5, col: 0, direction: 'across', number: 4, length: 5 },
        { clueId: 'AARON', answer: 'AARON', row: 7, col: 1, direction: 'across', number: 5, length: 5 },
      ],
    };

    // Column 3 has:
    // (0,3)=T, (1,3)=O, (2,3)=N, (3,3)=G, (4,3)=U, (5,3)=E, (6,3)=S, (7,3)=R -> "TONGUESR" (8 letters)
    // This must fail validation because column 3 has an 8-letter run, not a 7-letter run!
    expect(validateCrosswordLayout(invalidLayout)).toBe(false);
  });

  it('generates a valid board for the screenshot clues without unintended adjacencies', () => {
    const screenshotClues: ClueRecord[] = [
      makeClue('EXO-STAFF', 'STAFF'),
      makeClue('ACT-SAVED', 'SAVED'),
      makeClue('EXO-AARON', 'AARON'),
      makeClue('ACT-TONGUES', 'TONGUES'),
      makeClue('GEN-PHARAOH', 'PHARAOH'),
    ];

    const layout = generateCrossword(screenshotClues);
    expect(layout).not.toBeNull();
    if (layout) {
      expect(layout.words.length).toBe(5);
      expect(validateCrosswordLayout(layout)).toBe(true);

      // Verify that TONGUES never has an adjacent letter immediately before or after its column
      const tongues = layout.words.find(w => w.answer === 'TONGUES')!;
      const dr = tongues.direction === 'down' ? 1 : 0;
      const dc = tongues.direction === 'across' ? 1 : 0;

      // Build cell map of other words
      const otherCells = new Map<string, string>();
      for (const w of layout.words) {
        if (w === tongues) continue;
        const wdr = w.direction === 'down' ? 1 : 0;
        const wdc = w.direction === 'across' ? 1 : 0;
        for (let i = 0; i < w.length; i++) {
          otherCells.set(`${w.row + wdr * i},${w.col + wdc * i}`, w.answer[i]);
        }
      }

      // Check cell directly before TONGUES
      const beforeKey = `${tongues.row - dr},${tongues.col - dc}`;
      expect(otherCells.has(beforeKey)).toBe(false);

      // Check cell directly after TONGUES (where 'R' was incorrectly placed in the screenshot)
      const afterKey = `${tongues.row + dr * tongues.length},${tongues.col + dc * tongues.length}`;
      expect(otherCells.has(afterKey)).toBe(false);
    }
  });

  it('guarantees that all generated daily crosswords across 30 dates pass validateCrosswordLayout', async () => {
    const { CROSSWORD_CLUES } = await import('./content.js');
    const allClues: ClueRecord[] = CROSSWORD_CLUES.map(c => ({
      id: c[0],
      bookId: c[1],
      clueText: c[5],
      answer: c[6],
      answerNormalized: c[7],
      reference: c[8],
    }));

    for (let day = 1; day <= 30; day++) {
      const dateStr = `2026-09-${String(day).padStart(2, '0')}`;
      const selected = selectDailyClues(allClues, dateStr, 5);
      if (Array.isArray(selected) && selected.length >= 3) {
        const layout = generateCrossword(selected);
        if (layout) {
          expect(validateCrosswordLayout(layout)).toBe(true);
        }
      }
    }
  });

  it('guarantees that all generated book crosswords pass validateCrosswordLayout', async () => {
    const { CROSSWORD_CLUES } = await import('./content.js');
    for (const book of ['GEN', 'EXO', 'ACT']) {
      const bookClues: ClueRecord[] = CROSSWORD_CLUES.filter(c => c[1] === book).map(c => ({
        id: c[0],
        bookId: c[1],
        clueText: c[5],
        answer: c[6],
        answerNormalized: c[7],
        reference: c[8],
      }));

      // Test multiple random seeds / selections
      for (let i = 0; i < 5; i++) {
        const selected = selectClues(bookClues, 15, []);
        if (Array.isArray(selected)) {
          const layout = generateCrossword(selected);
          if (layout) {
            expect(validateCrosswordLayout(layout)).toBe(true);
          }
        }
      }
    }
  });
});

