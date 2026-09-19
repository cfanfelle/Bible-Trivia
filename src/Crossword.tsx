import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, Grid3X3, Calendar } from 'lucide-react';
import type { Book, CrosswordBoardState, CrosswordWord, CrosswordBookStats } from '../shared/types';
import './crossword.css';

const api = <T,>(c: string, p?: unknown) => window.selah.invoke<T>(c, p);

// ─── Hub ─────────────────────────────────────────────────────────────────────

export default function CrosswordHub({ books }: { books: Book[] }) {
  const [view, setView] = useState<'hub' | 'book-list' | 'board' | 'daily'>('hub');
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const [board, setBoard] = useState<CrosswordBoardState | null>(null);

  const openBook = useCallback(async (book: Book) => {
    setSelectedBook(book);
    // Try to load existing board first
    let b = await api<CrosswordBoardState | null>('crossword:board-get', book.id);
    if (!b) {
      try {
        b = await api<CrosswordBoardState>('crossword:board-new', book.id);
      } catch (e: any) {
        alert(e.message);
        return;
      }
    }
    setBoard(b);
    setView('board');
  }, []);

  const openDaily = useCallback(async () => {
    const b = await api<CrosswordBoardState | null>('crossword:daily-get');
    if (!b) {
      alert('No Crossword of the Day is available yet — the clue bank needs at least 3 approved clues.');
      return;
    }
    setBoard(b);
    setView('daily');
  }, []);

  if (view === 'board' && board && selectedBook) {
    return (
      <CrosswordBoard
        board={board}
        title={`${selectedBook.name} Crossword`}
        bookId={selectedBook.id}
        isDaily={false}
        onBack={() => { setView('book-list'); setBoard(null); }}
        onBoardUpdate={setBoard}
        onNewBoard={async () => {
          try {
            const b = await api<CrosswordBoardState>('crossword:board-new', selectedBook.id);
            setBoard(b);
          } catch (e: any) { alert(e.message); }
        }}
      />
    );
  }

  if (view === 'daily' && board) {
    const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    return (
      <CrosswordBoard
        board={board}
        title={`Daily Crossword — ${today}`}
        bookId="daily"
        isDaily={true}
        onBack={() => { setView('hub'); setBoard(null); }}
        onBoardUpdate={setBoard}
      />
    );
  }

  if (view === 'book-list') {
    return (
      <section className="crossword-hub page">
        <button className="back" onClick={() => setView('hub')}>
          <ChevronLeft size={18} /> Back
        </button>
        <span className="eyebrow">CROSSWORDS</span>
        <h1>Book Crosswords</h1>
        <p>Select a Bible book to solve its crossword. Progress saves automatically.</p>
        <BookCrosswordList books={books} onSelect={openBook} />
      </section>
    );
  }

  return (
    <section className="crossword-hub page">
      <span className="eyebrow">CROSSWORDS</span>
      <h1>Crosswords</h1>
      <p>Fill-in-the-blank Bible crosswords. Work through any Bible book or solve today's daily challenge.</p>
      <div className="cw-hub-grid">
        <div className="cw-daily-card card">
          <span className="eyebrow"><Calendar size={12} style={{ display: 'inline', marginRight: 5 }} />CROSSWORD OF THE DAY</span>
          <h2>Today's Challenge</h2>
          <p>A fresh set of clues every day, shared by everyone. Solve it and earn bonus XP.</p>
          <button className="primary" onClick={openDaily}>Open Today's Crossword</button>
        </div>
        <div className="card">
          <span className="eyebrow"><Grid3X3 size={12} style={{ display: 'inline', marginRight: 5 }} />BOOK CROSSWORDS</span>
          <h2>By Bible Book</h2>
          <p>Each Bible book has its own crossword. Progress is saved independently.</p>
          <button className="secondary" onClick={() => setView('book-list')}>Browse Books</button>
        </div>
      </div>
    </section>
  );
}

// ─── Book List ────────────────────────────────────────────────────────────────

function BookCrosswordList({ books, onSelect }: { books: Book[]; onSelect: (b: Book) => void }) {
  const [stats, setStats] = useState<Record<string, CrosswordBookStats>>({});
  const [clueInfo, setClueInfo] = useState<Record<string, { count: number; sufficient: boolean }>>({});

  useEffect(() => {
    // Load clue availability for all books (batched but sequential to avoid hammering IPC)
    const load = async () => {
      const info: typeof clueInfo = {};
      const st: typeof stats = {};
      for (const book of books) {
        const ci = await api<{ count: number; sufficient: boolean }>('crossword:clues-for-book', book.id);
        info[book.id] = ci;
        if (ci.count > 0) {
          const s = await api<CrosswordBookStats>('crossword:book-stats', book.id);
          st[book.id] = s;
        }
      }
      setClueInfo(info);
      setStats(st);
    };
    void load();
  }, [books]);

  return (
    <div className="book-cw-list">
      {books.map(book => {
        const ci = clueInfo[book.id];
        const s = stats[book.id];
        const hasClues = ci?.sufficient;
        return (
          <button
            key={book.id}
            className={`book-cw-item${hasClues ? '' : ' no-clues'}`}
            onClick={() => hasClues && onSelect(book)}
            disabled={!hasClues}
          >
            <b>{book.name}</b>
            {ci ? (
              hasClues ? (
                <>
                  <small>{ci.count} approved clues</small>
                  {s && (
                    <div className="book-cw-progress">
                      {s.boardsCompleted} {s.boardsCompleted === 1 ? 'board' : 'boards'} completed
                      {s.totalClues > 0 && ` · ${s.uniqueCluesSolved}/${s.totalClues} unique clues`}
                    </div>
                  )}
                </>
              ) : (
                <small>No crossword clues available yet ({ci.count}/15)</small>
              )
            ) : (
              <small>Loading…</small>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─── Crossword Board ──────────────────────────────────────────────────────────

interface BoardProps {
  board: CrosswordBoardState;
  title: string;
  bookId: string;
  isDaily: boolean;
  onBack: () => void;
  onBoardUpdate: (b: CrosswordBoardState) => void;
  onNewBoard?: () => void;
}

function CrosswordBoard({ board, title, bookId, isDaily, onBack, onBoardUpdate, onNewBoard }: BoardProps) {
  const [letters, setLetters] = useState<Record<string, string>>(board.letterState ?? {});
  const [solvedNums, setSolvedNums] = useState<number[]>(board.solvedWordNumbers ?? []);
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number } | null>(null);
  const [direction, setDirection] = useState<'across' | 'down'>('across');
  const [boardComplete, setBoardComplete] = useState(board.solvedWordNumbers?.length >= board.totalWords);
  const inputRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const { layout, clues } = board;
  const { words, rows, cols } = layout;

  // Build cell-to-word map
  const cellWords = React.useMemo(() => {
    const map = new Map<string, CrosswordWord[]>();
    for (const word of words) {
      const dr = word.direction === 'down' ? 1 : 0;
      const dc = word.direction === 'across' ? 1 : 0;
      for (let i = 0; i < word.length; i++) {
        const k = `${word.row + dr * i},${word.col + dc * i}`;
        if (!map.has(k)) map.set(k, []);
        map.get(k)!.push(word);
      }
    }
    return map;
  }, [words]);

  // Cell number map (start cells)
  const cellNumbers = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const word of words) map.set(`${word.row},${word.col}`, word.number);
    return map;
  }, [words]);

  // Active word
  const activeWord = React.useMemo(() => {
    if (!selectedCell) return null;
    const k = `${selectedCell.row},${selectedCell.col}`;
    const ws = cellWords.get(k) ?? [];
    return ws.find(w => w.direction === direction) ?? ws[0] ?? null;
  }, [selectedCell, direction, cellWords]);

  const activeCells = React.useMemo(() => {
    if (!activeWord) return new Set<string>();
    const s = new Set<string>();
    const dr = activeWord.direction === 'down' ? 1 : 0;
    const dc = activeWord.direction === 'across' ? 1 : 0;
    for (let i = 0; i < activeWord.length; i++) s.add(`${activeWord.row + dr * i},${activeWord.col + dc * i}`);
    return s;
  }, [activeWord]);

  const isWordSolved = useCallback((word: CrosswordWord) => {
    const dr = word.direction === 'down' ? 1 : 0;
    const dc = word.direction === 'across' ? 1 : 0;
    const clue = clues.find(c => c.id === word.clueId);
    if (!clue) return false;
    const norm = clue.answer.toUpperCase().replace(/[^A-Z]/g, '');
    for (let i = 0; i < word.length; i++) {
      const typed = letters[`${word.row + dr * i},${word.col + dc * i}`] ?? '';
      if (typed.toUpperCase() !== norm[i]) return false;
    }
    return true;
  }, [letters, clues]);

  // Check and mark solved words
  const checkSolved = useCallback(async (newLetters: Record<string, string>) => {
    const newSolved: number[] = [...solvedNums];
    let changed = false;
    for (const word of words) {
      if (newSolved.includes(word.number)) continue;
      const dr = word.direction === 'down' ? 1 : 0;
      const dc = word.direction === 'across' ? 1 : 0;
      const clue = clues.find(c => c.id === word.clueId);
      if (!clue) continue;
      const norm = clue.answer.toUpperCase().replace(/[^A-Z]/g, '');
      let correct = true;
      for (let i = 0; i < word.length; i++) {
        if ((newLetters[`${word.row + dr * i},${word.col + dc * i}`] ?? '').toUpperCase() !== norm[i]) {
          correct = false; break;
        }
      }
      if (correct) {
        newSolved.push(word.number);
        changed = true;
        const channel = isDaily ? 'crossword:daily-solve-word' : 'crossword:board-solve-word';
        await api(channel, { bookId, wordNumber: word.number, clueId: clue.id });
      }
    }
    if (changed) {
      setSolvedNums(newSolved);
      if (newSolved.length >= words.length) setBoardComplete(true);
    }
    return newSolved;
  }, [solvedNums, words, clues, bookId, isDaily]);

  // Autosave
  const scheduleSave = useCallback((newLetters: Record<string, string>, newSolved: number[]) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const channel = isDaily ? 'crossword:daily-save' : 'crossword:board-save';
      void api(channel, { bookId, letterState: newLetters, solvedWordNumbers: newSolved });
    }, 800);
  }, [bookId, isDaily]);

  const handleCellClick = (row: number, col: number) => {
    const k = `${row},${col}`;
    const ws = cellWords.get(k) ?? [];
    if (!ws.length) return;
    if (selectedCell?.row === row && selectedCell?.col === col) {
      // Toggle direction
      const other = ws.find(w => w.direction !== direction);
      if (other) setDirection(other.direction);
    } else {
      setSelectedCell({ row, col });
      // Prefer current direction if available
      const match = ws.find(w => w.direction === direction);
      if (!match) setDirection(ws[0].direction);
    }
    inputRef.current?.focus();
  };

  const advanceCursor = (row: number, col: number, dir: 'across' | 'down') => {
    const dr = dir === 'down' ? 1 : 0;
    const dc = dir === 'across' ? 1 : 0;
    const next = `${row + dr},${col + dc}`;
    if (cellWords.has(next)) setSelectedCell({ row: row + dr, col: col + dc });
  };

  const retreatCursor = (row: number, col: number, dir: 'across' | 'down') => {
    const dr = dir === 'down' ? 1 : 0;
    const dc = dir === 'across' ? 1 : 0;
    const prev = `${row - dr},${col - dc}`;
    if (cellWords.has(prev)) setSelectedCell({ row: row - dr, col: col - dc });
  };

  const handleKey = async (e: React.KeyboardEvent) => {
    if (!selectedCell) return;
    const { row, col } = selectedCell;

    if (e.key === 'Tab') {
      e.preventDefault();
      // Move to next word
      const idx = words.findIndex(w => w.number === activeWord?.number);
      const next = words[(idx + 1) % words.length];
      setSelectedCell({ row: next.row, col: next.col });
      setDirection(next.direction);
      return;
    }

    if (e.key === 'Backspace') {
      const k = `${row},${col}`;
      if (letters[k]) {
        const newL = { ...letters };
        delete newL[k];
        setLetters(newL);
        const newSolved = await checkSolved(newL);
        scheduleSave(newL, newSolved);
      } else {
        retreatCursor(row, col, direction);
      }
      return;
    }

    if (/^[a-zA-Z]$/.test(e.key)) {
      const k = `${row},${col}`;
      const newL = { ...letters, [k]: e.key.toUpperCase() };
      setLetters(newL);
      const newSolved = await checkSolved(newL);
      scheduleSave(newL, newSolved);
      advanceCursor(row, col, direction);
    }
  };

  const handleClueClick = (word: CrosswordWord) => {
    setSelectedCell({ row: word.row, col: word.col });
    setDirection(word.direction);
    inputRef.current?.focus();
  };

  const acrossWords = words.filter(w => w.direction === 'across').sort((a, b) => a.number - b.number);
  const downWords   = words.filter(w => w.direction === 'down').sort((a, b) => a.number - b.number);
  const solvedSet   = new Set(solvedNums);

  return (
    <section className="crossword-page page">
      <button className="back" onClick={onBack}><ChevronLeft size={18} /> Back</button>
      <div className="cw-board-header">
        <div>
          <span className="eyebrow">{isDaily ? 'CROSSWORD OF THE DAY' : 'BOOK CROSSWORD'}</span>
          <h2 style={{ margin: '4px 0' }}>{title}</h2>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="cw-progress-text">{solvedNums.length} / {words.length} solved</span>
          <div className="cw-direction-toggle">
            <button className={direction === 'across' ? 'active' : ''} onClick={() => setDirection('across')}>Across</button>
            <button className={direction === 'down' ? 'active' : ''} onClick={() => setDirection('down')}>Down</button>
          </div>
        </div>
      </div>

      {boardComplete ? (
        <div className="cw-complete-banner">
          <h2>🎉 Puzzle Complete!</h2>
          <p>You solved all {words.length} answers. Well done!</p>
          {!isDaily && onNewBoard && (
            <button className="primary" onClick={onNewBoard}>New Board</button>
          )}
          {!isDaily && <button className="secondary" style={{ marginLeft: 10 }} onClick={onBack}>Back to Books</button>}
        </div>
      ) : null}

      <div className="crossword-layout">
        <div>
          <div className="cw-grid-wrap" onKeyDown={handleKey} tabIndex={0}>
            <input
              ref={inputRef}
              className="cw-hidden-input"
              readOnly
              aria-hidden="true"
            />
            <div
              className="cw-grid"
              style={{ gridTemplateColumns: `repeat(${cols}, min-content)`, gridTemplateRows: `repeat(${rows}, min-content)` }}
            >
              {Array.from({ length: rows }, (_, r) =>
                Array.from({ length: cols }, (_, c) => {
                  const k = `${r},${c}`;
                  const isBlack = !cellWords.has(k);
                  const isSelected = selectedCell?.row === r && selectedCell?.col === c;
                  const inActiveWord = activeCells.has(k);
                  const letter = letters[k] ?? '';
                  const cellNum = cellNumbers.get(k);
                  const wordHere = cellWords.get(k)?.[0];
                  const solved = wordHere ? solvedSet.has(wordHere.number) : false;

                  return (
                    <div
                      key={k}
                      className={`cw-cell${isBlack ? ' black' : ''}${isSelected ? ' selected' : inActiveWord ? ' active-word' : ''}${solved ? ' correct' : ''}`}
                      onClick={() => !isBlack && handleCellClick(r, c)}
                    >
                      {!isBlack && cellNum && <span className="cw-num">{cellNum}</span>}
                      {!isBlack && (
                        <span className={`cw-letter${solved ? ' correct-letter' : ''}`}>
                          {letter}
                        </span>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Current clue prompt */}
          {activeWord && !boardComplete && (() => {
            const clue = clues.find(c => c.id === activeWord.clueId);
            return clue ? (
              <div style={{ marginTop: 14, padding: '12px 16px', background: 'var(--paper)', border: '1px solid #ded8cb', borderRadius: 10 }}>
                <small style={{ color: '#9a7750', fontWeight: 700, fontSize: 12 }}>{activeWord.number} {activeWord.direction.toUpperCase()}</small>
                <p style={{ margin: '4px 0 0', fontSize: 15 }}>{clue.clueText}</p>
                <small style={{ color: '#9a8070' }}>{clue.reference}</small>
              </div>
            ) : null;
          })()}
        </div>

        <div className="cw-clues">
          <div className="cw-clue-section">
            <h3>ACROSS</h3>
            <div className="cw-clue-list">
              {acrossWords.map(word => {
                const clue = clues.find(c => c.id === word.clueId);
                if (!clue) return null;
                const isActive = activeWord?.number === word.number && activeWord?.direction === 'across';
                const isSolved = solvedSet.has(word.number);
                return (
                  <button key={word.number} className={`cw-clue-item${isActive ? ' active' : ''}${isSolved ? ' solved' : ''}`} onClick={() => handleClueClick(word)}>
                    <span className="cw-clue-num">{word.number}</span>
                    <span>
                      <div className="cw-clue-text">{clue.clueText}{isSolved && <span className="cw-clue-solved-mark"> ✓</span>}</div>
                      <div className="cw-clue-ref">{clue.reference}</div>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="cw-clue-section">
            <h3>DOWN</h3>
            <div className="cw-clue-list">
              {downWords.map(word => {
                const clue = clues.find(c => c.id === word.clueId);
                if (!clue) return null;
                const isActive = activeWord?.number === word.number && activeWord?.direction === 'down';
                const isSolved = solvedSet.has(word.number);
                return (
                  <button key={word.number} className={`cw-clue-item${isActive ? ' active' : ''}${isSolved ? ' solved' : ''}`} onClick={() => handleClueClick(word)}>
                    <span className="cw-clue-num">{word.number}</span>
                    <span>
                      <div className="cw-clue-text">{clue.clueText}{isSolved && <span className="cw-clue-solved-mark"> ✓</span>}</div>
                      <div className="cw-clue-ref">{clue.reference}</div>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
