/**
 * electron/crossword.ts
 *
 * Pure TypeScript crossword generation logic — no Electron dependencies.
 * All exported functions are fully unit-testable.
 *
 * CONTENT RULE: This module NEVER generates, invents, or modifies crossword
 * clues or answers.  It only places caller-supplied approved answers in a grid.
 */

export interface ClueRecord {
  id: string;
  bookId: string;
  clueText: string;
  answer: string;
  answerNormalized: string; // A-Z uppercase only
  reference: string;
}

export interface PlacedWord {
  clueId: string;
  answer: string;           // normalized A-Z
  row: number;              // top-left row of word
  col: number;              // top-left col of word
  direction: 'across' | 'down';
  number: number;           // crossword numbering (1-based)
  length: number;
}

export interface CrosswordResult {
  words: PlacedWord[];
  rows: number;
  cols: number;
}

// ─── Deterministic seeded PRNG (LCG) ────────────────────────────────────────

/** Simple LCG seeded from a string — deterministic, no profile ID. */
export function seededLcg(seed: string): () => number {
  // Sum char codes then apply LCG
  let state = [...seed].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 1);
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

// ─── Clue / answer normalisation ────────────────────────────────────────────

/** Strip everything except A-Z, uppercase. */
export function normalizeCrosswordAnswer(answer: string): string {
  return answer.toUpperCase().replace(/[^A-Z]/g, '');
}

// ─── Clue selection ──────────────────────────────────────────────────────────

/**
 * Select `count` clues from `pool`, preferring clues NOT in `recentIds`.
 * Falls back to reusing recently-used clues if the pool is too small.
 * Returns the selected clues in a stable (deterministic for given seed) order.
 * Does NOT invent new clues.
 */
export function selectClues(
  pool: ClueRecord[],
  count: number,
  recentIds: string[],
  rng: () => number = Math.random,
): ClueRecord[] | { error: 'insufficient'; available: number; required: number } {
  const enabled = pool.filter(c => c.answerNormalized.length >= 2);
  if (enabled.length === 0) {
    return { error: 'insufficient', available: 0, required: count };
  }
  if (enabled.length < count) {
    return { error: 'insufficient', available: enabled.length, required: count };
  }

  const recentSet = new Set(recentIds);
  const fresh = shuffle(enabled.filter(c => !recentSet.has(c.id)), rng);
  const stale = shuffle(enabled.filter(c => recentSet.has(c.id)), rng);

  const combined = [...fresh, ...stale];
  return combined.slice(0, count);
}

/**
 * Deterministically select `count` clues from `pool` for a given date string.
 * Every call with the same (pool ids, dateStr, count) returns the same result.
 * Uses only the date string as the seed — never the profile ID.
 */
export function selectDailyClues(
  pool: ClueRecord[],
  dateStr: string,  // e.g. '2026-09-18'
  count: number,
): ClueRecord[] | { error: 'insufficient'; available: number; required: number } {
  const enabled = pool.filter(c => c.answerNormalized.length >= 2);
  if (enabled.length < count) {
    return { error: 'insufficient', available: enabled.length, required: count };
  }
  const rng = seededLcg(dateStr);
  const shuffled = shuffle([...enabled], rng);
  return shuffled.slice(0, count);
}

// ─── Crossword grid placement ─────────────────────────────────────────────────

type Cell = { letter: string };
type Grid = Map<string, Cell>;

function cellKey(row: number, col: number): string {
  return `${row},${col}`;
}

interface Placement {
  row: number;
  col: number;
  direction: 'across' | 'down';
  intersections: number; // how many intersections with existing words
}

/**
 * Generate a crossword layout for the given approved clues.
 * Returns null if a valid connected grid cannot be built — the caller should
 * try a different approved clue selection.  This function NEVER invents answers.
 */
export function generateCrossword(clues: ClueRecord[]): CrosswordResult | null {
  if (clues.length === 0) return null;

  // Sort by answer length descending for best placement results
  const sorted = [...clues].sort((a, b) => b.answerNormalized.length - a.answerNormalized.length);

  // Try starting with the longest word, but if that fails, try other starting words
  const maxStartAttempts = Math.min(sorted.length, 10);
  for (let startIdx = 0; startIdx < maxStartAttempts; startIdx++) {
    // Try deterministic greedy first, then slight rotation passes if needed
    for (let attempt = 0; attempt < 3; attempt++) {
      const grid: Grid = new Map();
      const placed: Array<{ clueId: string; answer: string; row: number; col: number; direction: 'across' | 'down' }> = [];

      // Place first word horizontally at origin
      const first = sorted[startIdx];
      for (let i = 0; i < first.answerNormalized.length; i++) {
        grid.set(cellKey(0, i), { letter: first.answerNormalized[i] });
      }
      placed.push({ clueId: first.id, answer: first.answerNormalized, row: 0, col: 0, direction: 'across' });

      let unplaced = sorted.filter((_, idx) => idx !== startIdx);
      if (attempt > 0) {
        unplaced = [...unplaced.slice(attempt), ...unplaced.slice(0, attempt)];
      }

      let failed = false;
      while (unplaced.length > 0) {
        let bestCandidate: { wordIndex: number; placement: Placement } | null = null;
        for (let i = 0; i < unplaced.length; i++) {
          const p = findBestPlacement(unplaced[i].answerNormalized, placed, grid);
          if (p) {
            if (!bestCandidate || p.intersections > bestCandidate.placement.intersections) {
              bestCandidate = { wordIndex: i, placement: p };
            }
          }
        }
        if (!bestCandidate) {
          failed = true;
          break;
        }
        const [nextWord] = unplaced.splice(bestCandidate.wordIndex, 1);
        applyPlacement(nextWord, bestCandidate.placement, placed, grid);
      }

      if (failed || placed.length < sorted.length) {
        continue;
      }

      // Normalise grid so min row/col = 0
      const rows = [...grid.keys()].map(k => parseInt(k.split(',')[0]));
      const cols = [...grid.keys()].map(k => parseInt(k.split(',')[1]));
      const minRow = Math.min(...rows);
      const minCol = Math.min(...cols);

      const normalisedPlaced = placed.map(p => ({
        ...p,
        row: p.row - minRow,
        col: p.col - minCol,
      }));

      const maxRow = Math.max(...rows) - minRow;
      const maxCol = Math.max(...cols) - minCol;

      // Assign crossword numbers (standard: left-to-right, top-to-bottom)
      const numberedWords = assignNumbers(normalisedPlaced, maxRow + 1, maxCol + 1);

      const result: CrosswordResult = {
        words: numberedWords,
        rows: maxRow + 1,
        cols: maxCol + 1,
      };

      if (validateCrosswordLayout(result)) {
        return result;
      }
    }
  }

  return null;
}

function findBestPlacement(
  word: string,
  placed: Array<{ answer: string; row: number; col: number; direction: 'across' | 'down' }>,
  grid: Grid,
): Placement | null {
  let best: Placement | null = null;

  for (const pw of placed) {
    const newDir: 'across' | 'down' = pw.direction === 'across' ? 'down' : 'across';

    for (let pi = 0; pi < pw.answer.length; pi++) {
      for (let wi = 0; wi < word.length; wi++) {
        if (pw.answer[pi] !== word[wi]) continue;

        // Intersection cell
        const ir = pw.row + (pw.direction === 'down' ? pi : 0);
        const ic = pw.col + (pw.direction === 'across' ? pi : 0);

        // New word start
        const nr = ir - (newDir === 'down' ? wi : 0);
        const nc = ic - (newDir === 'across' ? wi : 0);

        const candidate: Placement = { row: nr, col: nc, direction: newDir, intersections: 0 };

        if (!isValidPlacement(word, candidate, grid, placed)) continue;

        // Count intersections this placement creates
        let intersections = 0;
        for (let i = 0; i < word.length; i++) {
          const cr = nr + (newDir === 'down' ? i : 0);
          const cc = nc + (newDir === 'across' ? i : 0);
          if (grid.has(cellKey(cr, cc))) intersections++;
        }
        candidate.intersections = intersections;

        if (!best || intersections > best.intersections) {
          best = candidate;
        }
      }
    }
  }

  return best;
}

function findAnyPlacement(
  word: string,
  placed: Array<{ answer: string; row: number; col: number; direction: 'across' | 'down' }>,
  grid: Grid,
): Placement | null {
  // Same as findBestPlacement but accepts any valid placement
  return findBestPlacement(word, placed, grid);
}

function isValidPlacement(
  word: string,
  p: Placement,
  grid: Grid,
  placed: Array<{ answer: string; row: number; col: number; direction: 'across' | 'down' }>,
): boolean {
  const { row, col, direction } = p;
  const dr = direction === 'down' ? 1 : 0;
  const dc = direction === 'across' ? 1 : 0;

  // 1. Cell before word start must be empty
  if (grid.has(cellKey(row - dr, col - dc))) return false;
  // 2. Cell after word end must be empty
  if (grid.has(cellKey(row + dr * word.length, col + dc * word.length))) return false;

  let hasIntersection = false;

  for (let i = 0; i < word.length; i++) {
    const r = row + dr * i;
    const c = col + dc * i;
    const existing = grid.get(cellKey(r, c));

    if (existing) {
      // Must be same letter
      if (existing.letter !== word[i]) return false;

      // Cannot share a cell with another word in the same direction
      const sameDirOverlap = placed.some(pw => {
        if (pw.direction !== direction) return false;
        const pdr = pw.direction === 'down' ? 1 : 0;
        const pdc = pw.direction === 'across' ? 1 : 0;
        for (let j = 0; j < pw.answer.length; j++) {
          if (pw.row + pdr * j === r && pw.col + pdc * j === c) return true;
        }
        return false;
      });
      if (sameDirOverlap) return false;

      hasIntersection = true;
      // At an intersection cell, the perpendicular word passes through this cell legitimately
    } else {
      // Non-intersection cell: perpendicular neighbours must be strictly empty.
      // For 'across' word (dr=0, dc=1), perp is vertical (dr=1, dc=0): check (r-1, c) and (r+1, c).
      // For 'down' word (dr=1, dc=0), perp is horizontal (dr=0, dc=1): check (r, c-1) and (r, c+1).
      // If a perpendicular neighbour is filled, it would either touch another word or create
      // an unintended perpendicular letter run without a clue.
      const perpDr = dc;
      const perpDc = dr;
      if (grid.has(cellKey(r + perpDr, c + perpDc))) return false;
      if (grid.has(cellKey(r - perpDr, c - perpDc))) return false;
    }
  }

  // Must have at least one intersection with existing grid
  return hasIntersection;
}

/**
 * Validate that an entire crossword layout conforms to standard crossword rules:
 * 1. Every contiguous horizontal run of letters of length >= 2 exactly matches an Across clue.
 * 2. Every contiguous vertical run of letters of length >= 2 exactly matches a Down clue.
 * 3. No un-clued adjacent letters or merged words exist anywhere in the grid.
 * 4. All words are connected in a single graph component.
 */
export function validateCrosswordLayout(result: CrosswordResult): boolean {
  const { words, rows, cols } = result;
  if (!words || words.length === 0) return false;
  if (rows <= 0 || cols <= 0) return false;

  // Reconstruct 2D grid
  const grid: (string | null)[][] = Array.from({ length: rows }, () => Array(cols).fill(null));

  for (const w of words) {
    const dr = w.direction === 'down' ? 1 : 0;
    const dc = w.direction === 'across' ? 1 : 0;
    if (w.row < 0 || w.col < 0) return false;
    if (w.row + dr * (w.length - 1) >= rows || w.col + dc * (w.length - 1) >= cols) return false;

    for (let i = 0; i < w.length; i++) {
      const r = w.row + dr * i;
      const c = w.col + dc * i;
      const char = w.answer[i];
      if (grid[r][c] !== null && grid[r][c] !== char) {
        return false; // Letter clash
      }
      grid[r][c] = char;
    }
  }

  // Find all maximal horizontal letter runs of length >= 2
  const horizontalRuns: Array<{ row: number; col: number; length: number; text: string }> = [];
  for (let r = 0; r < rows; r++) {
    let startCol = -1;
    let text = '';
    for (let c = 0; c <= cols; c++) {
      const ch = c < cols ? grid[r][c] : null;
      if (ch !== null) {
        if (startCol === -1) startCol = c;
        text += ch;
      } else {
        if (startCol !== -1) {
          if (text.length >= 2) {
            horizontalRuns.push({ row: r, col: startCol, length: text.length, text });
          }
          startCol = -1;
          text = '';
        }
      }
    }
  }

  // Find all maximal vertical letter runs of length >= 2
  const verticalRuns: Array<{ row: number; col: number; length: number; text: string }> = [];
  for (let c = 0; c < cols; c++) {
    let startRow = -1;
    let text = '';
    for (let r = 0; r <= rows; r++) {
      const ch = r < rows ? grid[r][c] : null;
      if (ch !== null) {
        if (startRow === -1) startRow = r;
        text += ch;
      } else {
        if (startRow !== -1) {
          if (text.length >= 2) {
            verticalRuns.push({ row: startRow, col: c, length: text.length, text });
          }
          startRow = -1;
          text = '';
        }
      }
    }
  }

  const acrossWords = words.filter(w => w.direction === 'across');
  const downWords = words.filter(w => w.direction === 'down');

  // Count must match exactly
  if (horizontalRuns.length !== acrossWords.length) return false;
  if (verticalRuns.length !== downWords.length) return false;

  // Each horizontal run must match an across word exactly
  for (const hr of horizontalRuns) {
    const match = acrossWords.find(
      w => w.row === hr.row && w.col === hr.col && w.length === hr.length && w.answer === hr.text
    );
    if (!match) return false;
  }

  // Each vertical run must match a down word exactly
  for (const vr of verticalRuns) {
    const match = downWords.find(
      w => w.row === vr.row && w.col === vr.col && w.length === vr.length && w.answer === vr.text
    );
    if (!match) return false;
  }

  // Check connectivity: all words must belong to a single connected component
  if (words.length > 1) {
    const adj = new Map<number, Set<number>>();
    for (let i = 0; i < words.length; i++) adj.set(i, new Set());

    const cellToWords = new Map<string, number[]>();
    for (let idx = 0; idx < words.length; idx++) {
      const w = words[idx];
      const dr = w.direction === 'down' ? 1 : 0;
      const dc = w.direction === 'across' ? 1 : 0;
      for (let i = 0; i < w.length; i++) {
        const k = `${w.row + dr * i},${w.col + dc * i}`;
        const list = cellToWords.get(k) ?? [];
        list.push(idx);
        cellToWords.set(k, list);
      }
    }

    for (const wordIndices of cellToWords.values()) {
      if (wordIndices.length > 1) {
        for (let i = 0; i < wordIndices.length; i++) {
          for (let j = i + 1; j < wordIndices.length; j++) {
            adj.get(wordIndices[i])!.add(wordIndices[j]);
            adj.get(wordIndices[j])!.add(wordIndices[i]);
          }
        }
      }
    }

    const visited = new Set<number>();
    const queue = [0];
    visited.add(0);
    while (queue.length > 0) {
      const curr = queue.shift()!;
      for (const neighbor of adj.get(curr)!) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    if (visited.size !== words.length) return false;
  }

  return true;
}

function applyPlacement(
  clue: ClueRecord,
  p: Placement,
  placed: Array<{ clueId: string; answer: string; row: number; col: number; direction: 'across' | 'down' }>,
  grid: Grid,
): void {
  const { row, col, direction } = p;
  const dr = direction === 'down' ? 1 : 0;
  const dc = direction === 'across' ? 1 : 0;

  for (let i = 0; i < clue.answerNormalized.length; i++) {
    grid.set(cellKey(row + dr * i, col + dc * i), { letter: clue.answerNormalized[i] });
  }
  placed.push({ clueId: clue.id, answer: clue.answerNormalized, row, col, direction });
}

/**
 * Assign standard crossword numbering.
 * Cells are numbered left-to-right, top-to-bottom.
 * A cell gets a number if it starts an Across or Down word.
 */
function assignNumbers(
  placed: Array<{ clueId: string; answer: string; row: number; col: number; direction: 'across' | 'down' }>,
  rows: number,
  cols: number,
): PlacedWord[] {
  // Find all cells that start a word in placed
  const startCells = new Set<string>();
  for (const pw of placed) {
    startCells.add(cellKey(pw.row, pw.col));
  }

  // Scan grid in reading order: top-to-bottom, left-to-right
  const cellNumbers = new Map<string, number>();
  let nextNum = 1;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const k = cellKey(r, c);
      if (startCells.has(k)) {
        cellNumbers.set(k, nextNum++);
      }
    }
  }

  return placed.map(pw => {
    const num = cellNumbers.get(cellKey(pw.row, pw.col)) ?? 1;
    return {
      clueId: pw.clueId,
      answer: pw.answer,
      row: pw.row,
      col: pw.col,
      direction: pw.direction,
      number: num,
      length: pw.answer.length,
    };
  });
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function shuffle<T>(arr: T[], rng: () => number = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
