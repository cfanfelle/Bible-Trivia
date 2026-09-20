export type Medal = 'none' | 'bronze' | 'silver' | 'gold' | 'diamond';
export type QuizMode = 'full' | 'practice' | 'daily';
export interface Profile { id:number; name:string; avatarId:string; xp:number; currentStreak:number; longestStreak:number; lastActiveDate:string|null; selectedBanner:string|null }
export interface Question { id:string; bookId:string; bookName:string; chapter:number; verseStart:number; verseEnd:number; text:string; choices:string[] }
export interface QuizState { sessionId:number; mode:QuizMode; bookId:string|null; title:string; currentIndex:number; total:number; answered:number; correct:number; completed:boolean; current:Question|null; selectedIndex:number|null; correctIndex:number|null; isCorrect:boolean|null }
export interface Book { id:string; name:string; testament:'OT'|'NT'; order:number; chapters:number }
export interface Verse { verse:number; text:string; highlightColor?:string; note?:string; bookmarked?:boolean; temporary?:boolean }
export interface VerseSearchResult { bookId:string; bookName:string; chapter:number; verse:number; text:string }
export interface BibleTranslation { id:string; name:string; abbreviation:string; description:string; license:string }
export interface ChapterBookmark { color:'red'|'gold'|'green'|'blue'|'purple';bookId:string;bookName:string;chapter:number }
export interface Bootstrap { profiles:Profile[]; activeProfile:Profile|null; books:Book[]; animals:{id:string;name:string;emoji:string;unlockLevel:number}[]; appVersion:string; bankVersion:string }

// ── Crossword ──────────────────────────────────────────────────────────────
export interface CrosswordClue { id:string; bookId:string; chapter:number; verseStart:number; verseEnd:number; clueText:string; answer:string; reference:string }
/** One word placed in the grid */
export interface CrosswordWord { number:number; direction:'across'|'down'; clueId:string; row:number; col:number; length:number }
/** Serialisable layout stored in the DB and sent to the renderer */
export interface CrosswordLayout { words:CrosswordWord[]; rows:number; cols:number }
/** Full board state sent to the renderer */
export interface CrosswordBoardState {
  bookId:string;
  localDate?:string;       // only for daily boards
  clues:CrosswordClue[];
  layout:CrosswordLayout;
  letterState:Record<string,string>; // "row,col" → typed letter
  solvedWordNumbers:number[];
  totalWords:number;
}
export interface CrosswordBookStats { boardsCompleted:number; uniqueCluesSolved:number; totalClues:number }

// ── Verse Memory Trainer ───────────────────────────────────────────────────
export type MasteryLevel = 'learning'|'bronze'|'silver'|'gold'|'diamond';
export interface MemoryVerse {
  id:number;
  profile_id?:number;
  profileId?:number;
  reference:string;
  translation:string|null;
  master_text:string;
  masterText?:string;
  created_at?:string;
  createdAt?:string;
  updated_at?:string;
  updatedAt?:string;
  difficulty_level?:number;
  difficultyLevel?:number;
  chunks?:string;
  current_chunk_index?:number;
  currentChunkIndex?:number;
  mastery:MasteryLevel;
  next_review_date?:string|null;
  nextReviewDate?:string|null;
  last_reviewed?:string|null;
  lastReviewed?:string|null;
  review_interval_days?:number;
  reviewIntervalDays?:number;
  successful_reviews?:number;
  successfulReviews?:number;
  total_reviews?:number;
  totalReviews?:number;
}
export interface MemoryChunk { index:number; text:string; start:number; end:number }
export type ExerciseType = 'study'|'word-bank'|'easy-blanks'|'hard-blanks'|'first-letters'|'chunk-recall'|'combined-chunks'|'full-recall';
export interface Exercise {
  type:ExerciseType;
  chunkIndices:number[];  // which chunks are active in this exercise
  displayText:string;     // text to show (with blanks/hints as appropriate)
  promptText?:string;     // context/prompt for user
  wordBank?:string[];     // for word-bank level
  missingIndices?:number[]; // word indices that are blanked
  blankPositions?:number[];
  blankAnswers?:Record<number, string>;
}
export interface AttemptResult {
  score:number;           // 0–1
  correct:string[];
  typos:{word:string;typed:string}[];
  missing:string[];
  wrong:{expected:string;typed:string}[];
  extra:string[];
  misplaced?:string[];
  reordered:boolean;
  passed:boolean;
}

