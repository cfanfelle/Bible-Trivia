import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, Plus, BookOpen, RotateCcw } from 'lucide-react';
import type { MemoryVerse, MasteryLevel, AttemptResult, Exercise } from '../shared/types';
import './trainer.css';

const api = <T,>(c: string, p?: unknown) => window.selah.invoke<T>(c, p);

const LEVEL_NAMES: Record<number, string> = {
  1: 'STUDY', 2: 'WORD BANK', 3: 'EASY BLANKS', 4: 'HARD BLANKS',
  5: 'FIRST LETTERS', 6: 'CHUNK RECALL', 7: 'COMBINED CHUNKS', 8: 'FULL RECALL',
};

function MasteryBadge({ level }: { level: MasteryLevel }) {
  const labels: Record<MasteryLevel, string> = {
    learning: 'Learning', bronze: 'Bronze', silver: 'Silver', gold: 'Gold', diamond: 'Diamond',
  };
  return <span className={`mastery-badge ${level}`}>{labels[level]}</span>;
}

// ─── Hub ─────────────────────────────────────────────────────────────────────

interface HubProps { dueCount: number; onDueCountChange: (n: number) => void }

export default function VerseTrainerHub({ dueCount, onDueCountChange }: HubProps) {
  const [view, setView] = useState<'hub' | 'library' | 'add' | 'train' | 'review'>('hub');
  const [selectedVerse, setSelectedVerse] = useState<MemoryVerse | null>(null);
  const [verses, setVerses] = useState<MemoryVerse[]>([]);

  const refresh = async () => {
    const list = await api<MemoryVerse[]>('memory:list');
    setVerses(list);
    const due = await api<number>('memory:due-count');
    onDueCountChange(due);
  };

  useEffect(() => { void refresh(); }, []);

  const handleSaveVerse = async (data: { reference: string; translation: string; masterText: string }) => {
    await api<MemoryVerse>('memory:add', data);
    await refresh();
    setView('library');
  };

  if (view === 'add') {
    return <AddVerseForm onSave={handleSaveVerse} onBack={() => setView('library')} />;
  }

  if (view === 'train' && selectedVerse) {
    return (
      <TrainingSession
        verse={selectedVerse}
        onBack={async () => { await refresh(); setView('library'); }}
        onRefreshVerse={async () => {
          const v = await api<MemoryVerse>('memory:get', selectedVerse.id);
          setSelectedVerse(v);
          return v;
        }}
      />
    );
  }

  if (view === 'review') {
    return (
      <ReviewSession
        onBack={async () => { await refresh(); setView('hub'); }}
      />
    );
  }

  if (view === 'library') {
    return (
      <MemoryLibrary
        verses={verses}
        onBack={() => setView('hub')}
        onAdd={() => setView('add')}
        onTrain={(v) => { setSelectedVerse(v); setView('train'); }}
        onDelete={async (id) => { await api('memory:delete', id); await refresh(); }}
        onRefresh={refresh}
      />
    );
  }

  // Hub
  return (
    <section className="trainer-hub page">
      <span className="eyebrow">MEMORIZE</span>
      <h1>Verse Trainer</h1>
      <p>Add any Scripture you want to memorize. The trainer progressively removes hints until you can recall it completely from memory.</p>

      <div className="trainer-hub-grid">
        {dueCount > 0 && (
          <div className="card" style={{ gridColumn: 'span 2', background: 'linear-gradient(110deg,#345d4e,#253f37)', color: 'white' }}>
            <span className="eyebrow" style={{ color: '#d7ba7c' }}>REVIEW TODAY</span>
            <h2 style={{ margin: '8px 0' }}>{dueCount} {dueCount === 1 ? 'verse' : 'verses'} due for review</h2>
            <p style={{ color: '#dce5df' }}>Keep long-term memory strong with today's scheduled reviews.</p>
            <button className="primary" style={{ background: '#c8a763', border: 'none' }} onClick={() => setView('review')}>
              Start Review Session
            </button>
          </div>
        )}
        <div className="card">
          <span className="eyebrow">MEMORY LIBRARY</span>
          <h2>Your Verses</h2>
          <p>{verses.length > 0 ? `${verses.length} saved verse${verses.length > 1 ? 's' : ''}` : 'No verses added yet'}</p>
          <button className="secondary" onClick={() => setView('library')}>Open Library</button>
        </div>
        <div className="card">
          <span className="eyebrow">ADD VERSE</span>
          <h2>New Verse</h2>
          <p>Add any translation or wording you want to memorize.</p>
          <button className="secondary" onClick={() => { setView('add'); }}>
            <Plus size={16} style={{ display: 'inline', marginRight: 5 }} />Add Verse
          </button>
        </div>
      </div>
    </section>
  );
}

// ─── Memory Library ───────────────────────────────────────────────────────────

function MemoryLibrary({
  verses, onBack, onAdd, onTrain, onDelete, onRefresh,
}: {
  verses: MemoryVerse[];
  onBack: () => void;
  onAdd: () => void;
  onTrain: (v: MemoryVerse) => void;
  onDelete: (id: number) => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const today = new Date().toLocaleDateString('en-CA');
  return (
    <section className="trainer-hub page">
      <button className="back" onClick={onBack}><ChevronLeft size={18} /> Back</button>
      <span className="eyebrow">MEMORY LIBRARY</span>
      <h1>Your Verses</h1>

      <button className="primary" style={{ marginTop: 16, marginBottom: 4 }} onClick={onAdd}>
        <Plus size={16} style={{ display: 'inline', marginRight: 6 }} />Add Verse
      </button>

      {verses.length === 0 ? (
        <div className="cw-empty" style={{ marginTop: 40 }}>
          <BookOpen size={40} />
          <h3>No verses saved yet</h3>
          <p>Add the first verse you want to memorize.</p>
        </div>
      ) : (
        <div className="memory-list">
          {verses.map(v => {
            const nextDate = v.nextReviewDate ?? v.next_review_date;
            const isDue = Boolean(nextDate && nextDate <= today);
            return (
              <div className="memory-item card" key={v.id}>
                <div className="memory-item-info">
                  <h3>{v.reference}{v.translation && <small style={{ color: '#888', marginLeft: 6 }}>{v.translation}</small>}</h3>
                  <p title={v.master_text}>{v.master_text}</p>
                  <div className="memory-item-meta">
                    <MasteryBadge level={v.mastery ?? 'learning'} />
                    <small style={{ color: '#788079' }}>Level {LEVEL_NAMES[v.difficulty_level ?? 1]}</small>
                    {isDue && <span className="mastery-badge learning" style={{ background: '#fff0d8', color: '#b65f39' }}>Due for review</span>}
                    {nextDate && !isDue && <small style={{ color: '#788079' }}>Next review: {nextDate}</small>}
                    {v.successful_reviews !== undefined && v.successful_reviews > 0 && (
                      <small style={{ color: '#788079' }}>✓ {v.successful_reviews} review{v.successful_reviews !== 1 ? 's' : ''}</small>
                    )}
                  </div>
                </div>
                <div className="memory-item-actions">
                  <button onClick={() => onTrain(v)}>Practice</button>
                  <button className="delete-btn" onClick={async () => {
                    if (confirm(`Remove "${v.reference}" from your library?`)) await onDelete(v.id);
                  }}>✕</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ─── Add Verse Form ───────────────────────────────────────────────────────────

function AddVerseForm({ onSave, onBack }: {
  onSave: (d: { reference: string; translation: string; masterText: string }) => Promise<void>;
  onBack: () => void;
}) {
  const [reference, setReference] = useState('');
  const [translation, setTranslation] = useState('');
  const [masterText, setMasterText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!reference.trim() || !masterText.trim()) { setError('Reference and verse text are required.'); return; }
    setSaving(true);
    try {
      await onSave({ reference: reference.trim(), translation: translation.trim(), masterText: masterText.trim() });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="trainer-hub page">
      <button className="back" onClick={onBack}><ChevronLeft size={18} /> Back</button>
      <span className="eyebrow">MEMORIZE</span>
      <h1>Add a Verse</h1>
      <p>Type or paste exactly what you want to memorize. The trainer uses your wording precisely — it will never change it.</p>

      <div className="add-verse-form card">
        {error && <p style={{ color: '#a75b53', margin: '0 0 12px' }}>{error}</p>}
        <div className="add-verse-ref-row">
          <label>
            Reference *
            <input placeholder="e.g. Philippians 4:13" value={reference} onChange={e => setReference(e.target.value)} />
          </label>
          <label>
            Translation <span style={{ fontWeight: 'normal', color: '#888' }}>(optional)</span>
            <input placeholder="e.g. NIV, ESV, KJV…" value={translation} onChange={e => setTranslation(e.target.value)} />
          </label>
        </div>
        <label>
          Verse / Passage Text *
          <small className="master-text-hint">Paste or type the exact wording you want to memorize. Capitalization and punctuation are preserved.</small>
          <textarea
            placeholder="I can do all things through Christ who strengthens me."
            value={masterText}
            onChange={e => setMasterText(e.target.value)}
          />
        </label>
        <button className="primary" disabled={saving || !reference.trim() || !masterText.trim()} onClick={submit}>
          {saving ? 'Saving…' : 'Start Memorizing'}
        </button>
      </div>
    </section>
  );
}

// ─── Training Session ─────────────────────────────────────────────────────────

interface ExerciseData {
  exercise: Exercise;
  chunks: { index: number; text: string; wordCount: number }[];
  level: number;
  currentChunk: number;
  weakWords: { word: string; failCount: number }[];
}

function TrainingSession({ verse, onBack, onRefreshVerse }: {
  verse: MemoryVerse;
  onBack: () => void;
  onRefreshVerse: () => Promise<MemoryVerse>;
}) {
  const [exData, setExData] = useState<ExerciseData | null>(null);
  const [attempt, setAttempt] = useState('');
  const [usedBankWords, setUsedBankWords] = useState<string[]>([]);
  const [blankInputs, setBlankInputs] = useState<Record<number, string>>({});
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [newLevel, setNewLevel] = useState<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const loadExercise = async () => {
    const data = await api<ExerciseData>('memory:exercise', verse.id);
    setExData(data);
    setAttempt('');
    setUsedBankWords([]);
    setBlankInputs({});
    setResult(null);
    setNewLevel(null);
  };

  useEffect(() => { void loadExercise(); }, [verse.id]);

  const submit = async () => {
    if (!exData) return;
    setSubmitting(true);
    try {
      let finalAttempt = attempt;
      // For blank-fill modes, reconstruct the attempt from blank inputs
      if (exData.exercise.type === 'easy-blanks' || exData.exercise.type === 'hard-blanks') {
        const words = exData.exercise.displayText.split(' ');
        finalAttempt = words.map((w, i) => {
          if (w === '___') return blankInputs[i] ?? '';
          return w;
        }).join(' ');
      }
      if (exData.exercise.type === 'word-bank') {
        const words = exData.exercise.displayText.split(' ');
        let bankIdx = 0;
        finalAttempt = words.map(w => {
          if (w === '___') return usedBankWords[bankIdx++] ?? '';
          return w;
        }).join(' ');
      }
      if (exData.exercise.type === 'study' || level === 1) {
        finalAttempt = exData.exercise.displayText;
      }
      const res = await api<{ result: AttemptResult; newLevel: number; passed: boolean }>('memory:submit', {
        id: verse.id,
        attempt: finalAttempt,
      });
      if (exData.exercise.type === 'study' || level === 1) {
        await loadExercise();
        return;
      }
      setResult(res.result);
      setNewLevel(res.newLevel);
    } finally {
      setSubmitting(false);
    }
  };

  const continueToNext = () => { void loadExercise(); };

  if (!exData) return <div className="loading">Loading exercise…</div>;

  const { exercise, level, currentChunk, chunks } = exData;
  const levelName = LEVEL_NAMES[level] ?? `Level ${level}`;

  return (
    <section className="training-session page">
      <button className="back" onClick={onBack}><ChevronLeft size={18} /> Back to Library</button>

      <div className="trainer-progress">
        <div className="trainer-progress-row">
          <span className="verse-ref">{verse.reference}{verse.translation && ` (${verse.translation})`}</span>
          <MasteryBadge level={verse.mastery ?? 'learning'} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
          <span className="level-tag">{levelName}</span>
          {chunks.length > 1 && (
            <span style={{ fontSize: 12, color: '#788079' }}>
              Chunk {currentChunk + 1} of {chunks.length}
            </span>
          )}
          {newLevel !== null && newLevel !== level && (
            <span style={{ fontSize: 12, fontWeight: 700, color: newLevel > level ? '#315d4c' : '#9a7750' }}>
              {newLevel > level ? '↑ Level up!' : '↓ More practice'}
            </span>
          )}
        </div>
      </div>

      {result ? (
        <ResultDisplay
          result={result}
          expectedText={chunks[currentChunk]?.text ?? verse.master_text}
          level={level}
          onContinue={continueToNext}
        />
      ) : (
        <ExerciseView
          exercise={exercise}
          attempt={attempt}
          setAttempt={setAttempt}
          blankInputs={blankInputs}
          setBlankInputs={setBlankInputs}
          usedBankWords={usedBankWords}
          setUsedBankWords={setUsedBankWords}
          onSubmit={submit}
          submitting={submitting}
          textareaRef={textareaRef}
          level={level}
          verse={verse}
        />
      )}
    </section>
  );
}

function ExerciseView({
  exercise, attempt, setAttempt, blankInputs, setBlankInputs,
  usedBankWords, setUsedBankWords, onSubmit, submitting, textareaRef, level, verse,
}: {
  exercise: Exercise;
  attempt: string;
  setAttempt: (s: string) => void;
  blankInputs: Record<number, string>;
  setBlankInputs: (r: Record<number, string>) => void;
  usedBankWords: string[];
  setUsedBankWords: (w: string[]) => void;
  onSubmit: () => void;
  submitting: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  level: number;
  verse: MemoryVerse;
}) {
  switch (exercise.type) {
    case 'study':
      return (
        <>
          <p className="recall-prompt">Read and study this passage. Press Continue when you feel familiar with it.</p>
          <div className="master-display">{exercise.displayText}</div>
          <button className="primary" style={{ marginTop: 18 }} onClick={onSubmit} disabled={submitting}>
            {submitting ? 'Saving…' : 'Continue'}
          </button>
        </>
      );

    case 'word-bank': {
      const words = exercise.displayText.split(' ');
      let bankIdx = 0;
      return (
        <>
          <p className="recall-prompt">Fill in the blanks using the words below.</p>
          <div className="blanked-text">
            {words.map((w, i) => {
              if (w !== '___') return <React.Fragment key={i}>{w} </React.Fragment>;
              const filled = usedBankWords[bankIdx];
              const bi = bankIdx++;
              return (
                <span key={i} className="blank-word" style={{ cursor: filled ? 'pointer' : 'default' }}
                  onClick={() => {
                    if (filled) {
                      const newBank = [...usedBankWords];
                      newBank.splice(bi, 1);
                      setUsedBankWords(newBank);
                    }
                  }}>
                  {filled ?? '___'}
                </span>
              );
            })} 
          </div>
          <div className="word-bank">
            {(exercise.wordBank ?? []).map((chip, ci) => (
              <button
                key={ci}
                className={`word-chip${usedBankWords.includes(chip) ? ' used' : ''}`}
                onClick={() => !usedBankWords.includes(chip) && setUsedBankWords([...usedBankWords, chip])}
              >
                {chip}
              </button>
            ))}
          </div>
          <button className="primary" onClick={onSubmit} disabled={submitting}>
            {submitting ? 'Checking…' : 'Submit'}
          </button>
        </>
      );
    }

    case 'easy-blanks':
    case 'hard-blanks': {
      const words = exercise.displayText.split(' ');
      return (
        <>
          <p className="recall-prompt">Fill in the missing words from memory.</p>
          <div className="blanked-text">
            {words.map((w, i) => {
              if (w !== '___') return <React.Fragment key={i}>{w} </React.Fragment>;
              return (
                <input
                  key={i}
                  className="blank-input"
                  value={blankInputs[i] ?? ''}
                  onChange={e => setBlankInputs({ ...blankInputs, [i]: e.target.value })}
                />
              );
            })}
          </div>
          <button className="primary" style={{ marginTop: 16 }} onClick={onSubmit} disabled={submitting}>
            {submitting ? 'Checking…' : 'Submit'}
          </button>
        </>
      );
    }

    case 'first-letters':
      return (
        <>
          <p className="recall-prompt">The first letter of each word is shown. Type the full passage from memory.</p>
          <div className="first-letter-display">{exercise.displayText}</div>
          <textarea
            ref={textareaRef}
            className="recall-textarea"
            style={{ marginTop: 16 }}
            placeholder="Type the passage here…"
            value={attempt}
            onChange={e => setAttempt(e.target.value)}
            autoFocus
          />
          <button className="primary" style={{ marginTop: 12 }} onClick={onSubmit} disabled={submitting || !attempt.trim()}>
            {submitting ? 'Checking…' : 'Submit'}
          </button>
        </>
      );

    case 'chunk-recall':
    case 'combined-chunks':
    case 'full-recall':
      return (
        <>
          <p className="recall-prompt">{exercise.promptText || `Type ${verse.reference} from memory.`}</p>
          <textarea
            ref={textareaRef}
            className="recall-textarea"
            placeholder="Type from memory…"
            value={attempt}
            onChange={e => setAttempt(e.target.value)}
            autoFocus
          />
          <button className="primary" style={{ marginTop: 12 }} onClick={onSubmit} disabled={submitting || !attempt.trim()}>
            {submitting ? 'Checking…' : 'Submit'}
          </button>
        </>
      );
  }
}

function ResultDisplay({ result, expectedText, level, onContinue }: {
  result: AttemptResult;
  expectedText: string;
  level: number;
  onContinue: () => void;
}) {
  const scorePct = Math.round(result.score * 100);
  return (
    <div className="diff-result">
      <div className="diff-tags">
        <span className={`diff-tag ${result.passed ? 'passed' : 'failed'}`}>
          {result.passed ? '✓ Passed' : '✗ Keep practicing'} — {scorePct}%
        </span>
        {result.typos.length > 0 && <span className="diff-tag" style={{ background: '#fdf5d8', color: '#9a7750' }}>~{result.typos.length} typo{result.typos.length > 1 ? 's' : ''} (minor)</span>}
        {result.missing.length > 0 && <span className="diff-tag" style={{ background: '#f7e7e5', color: '#a75b53' }}>{result.missing.length} missing</span>}
        {result.wrong.length > 0 && <span className="diff-tag" style={{ background: '#f7e7e5', color: '#a75b53' }}>{result.wrong.length} wrong</span>}
        {result.reordered && <span className="diff-tag" style={{ background: '#f7e7e5', color: '#a75b53' }}>reordered</span>}
      </div>

      {(!result.passed && level >= 5) && (
        <div style={{ marginTop: 14 }}>
          <small style={{ color: '#9a7750', fontWeight: 700, fontSize: 12 }}>MASTER TEXT</small>
          <div className="diff-master" style={{ marginTop: 6 }}>{expectedText}</div>
        </div>
      )}

      {result.missing.length > 0 && (
        <p style={{ marginTop: 12, fontSize: 14, color: '#a75b53' }}>
          <b>Missing:</b> {result.missing.join(', ')}
        </p>
      )}
      {result.wrong.length > 0 && (
        <p style={{ fontSize: 14, color: '#a75b53' }}>
          <b>Wrong:</b> {result.wrong.map(w => `"${w.typed}" instead of "${w.expected}"`).join('; ')}
        </p>
      )}
      {result.typos.length > 0 && (
        <p style={{ fontSize: 14, color: '#9a7750' }}>
          <b>Typos (counted as correct):</b> {result.typos.map(t => `"${t.typed}"`).join(', ')}
        </p>
      )}

      <button className="primary" style={{ marginTop: 18 }} onClick={onContinue}>
        Continue
      </button>
    </div>
  );
}

// ─── Review Session ───────────────────────────────────────────────────────────

function ReviewSession({ onBack }: { onBack: () => void }) {
  const [queue, setQueue] = useState<MemoryVerse[]>([]);
  const [current, setCurrent] = useState(0);
  const [attempt, setAttempt] = useState('');
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api<MemoryVerse[]>('memory:review-list').then(list => {
      setQueue(list);
      setLoaded(true);
    });
  }, []);

  const verse = queue[current];

  const submit = async () => {
    if (!verse || !attempt.trim()) return;
    setSubmitting(true);
    try {
      // Use full-recall comparison against master text
      const subRes = await api<{ result: AttemptResult; newLevel: number; passed: boolean }>('memory:submit', {
        id: verse.id,
        attempt: attempt.trim(),
      });
      setResult(subRes.result);
      // Complete review with the score
      await api('memory:complete-review', { id: verse.id, score: subRes.result.score });
    } finally {
      setSubmitting(false);
    }
  };

  const next = () => {
    setAttempt('');
    setResult(null);
    if (current + 1 >= queue.length) setDone(true);
    else setCurrent(c => c + 1);
  };

  if (!loaded) return <div className="loading">Loading reviews…</div>;

  if (queue.length === 0 || done) {
    return (
      <section className="review-session page">
        <button className="back" onClick={onBack}><ChevronLeft size={18} /> Back</button>
        <span className="eyebrow">REVIEW TODAY</span>
        <h1>{done ? 'Review Complete!' : 'No Reviews Due'}</h1>
        <p>{done ? `You reviewed all ${queue.length} verse${queue.length > 1 ? 's' : ''}. Well done!` : 'Check back later when verses are due for review.'}</p>
        <button className="primary" onClick={onBack}>Done</button>
      </section>
    );
  }

  return (
    <section className="review-session page">
      <button className="back" onClick={onBack}><ChevronLeft size={18} /> Back</button>
      <span className="eyebrow">REVIEW TODAY</span>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>{verse.reference}</h1>
        <small style={{ color: '#788079' }}>{current + 1} / {queue.length}</small>
      </div>
      {verse.translation && <small style={{ color: '#9a7750' }}>{verse.translation}</small>}

      {result ? (
        <>
          <ResultDisplay result={result} expectedText={verse.master_text} level={8} onContinue={next} />
        </>
      ) : (
        <>
          <p className="recall-prompt">Type <b>{verse.reference}</b> from memory.</p>
          <textarea
            className="recall-textarea"
            placeholder="Type from memory…"
            value={attempt}
            onChange={e => setAttempt(e.target.value)}
            autoFocus
          />
          <button className="primary" style={{ marginTop: 12 }} onClick={submit} disabled={submitting || !attempt.trim()}>
            {submitting ? 'Checking…' : 'Submit'}
          </button>
        </>
      )}
    </section>
  );
}
