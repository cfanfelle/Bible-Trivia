import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Home,
  BookOpen,
  Trophy,
  Dumbbell,
  UserRound,
  Flame,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  XCircle,
  X,
  Users,
  Grid3X3,
  Brain,
} from "lucide-react";
import type {
  Bootstrap,
  Profile,
  QuizState,
  Verse,
  Book,
  Medal,
} from "../shared/types";
import Reader from "./Reader";
import Online from "./OnlineLive";
import CrosswordHub from "./Crossword";
import VerseTrainerHub from "./VerseTrainer";
import "./styles.css";
import "./avatar.css";
import "./session-exit.css";
import "./logo.css";
import "./update-status.css";
import "./crossword.css";
import "./trainer.css";

const api = <T,>(c: string, p?: unknown) => window.selah.invoke<T>(c, p);
const medal = (p: number): Medal =>
  p >= 100
    ? "diamond"
    : p >= 90
      ? "gold"
      : p >= 80
        ? "silver"
        : p >= 70
          ? "bronze"
          : "none";
function App() {
  const [boot, setBoot] = useState<Bootstrap | null>(null),
    [page, setPage] = useState("home"),
    [session, setSession] = useState<QuizState | null>(null),
    [passage, setPassage] = useState(false),
    [dueCount, setDueCount] = useState(0);
  const refresh = () => api<Bootstrap>("bootstrap").then(setBoot);
  useEffect(() => {
    refresh();
    api<QuizState | null>("session:active").then(setSession);
    api<number>("memory:due-count").then(setDueCount).catch(() => {});
    const f = () => window.selah.activity();
    for (const e of ["pointerdown", "keydown", "wheel"])
      window.addEventListener(e, f);
    return () => {
      for (const e of ["pointerdown", "keydown", "wheel"])
        window.removeEventListener(e, f);
    };
  }, []);
  if (!boot) return <div className="loading">Opening Bible Trivia…</div>;
  if (!boot.activeProfile) return <ProfileGate boot={boot} refresh={refresh} />;
  const p = boot.activeProfile;
  const level = levelAt(p.xp);
  const nav = [
    ["home", "Home", Home],
    ["quizzes", "Full Quizzes", Trophy],
    ["practice", "Practice", Dumbbell],
    ["crosswords", "Crosswords", Grid3X3],
    ["memorize", "Memorize", Brain],
    ["bible", "Bible", BookOpen],
    ["online", "Online", Users],
    ["medals", "Medals", Trophy],
    ["profile", "Progress", UserRound],
  ] as const;
  const exitSession = async (target = "home") => {
    if (
      session &&
      !session.completed &&
      session.currentIndex + 1 >= session.total
    ) {
      const finished = await api<QuizState>("session:next", session.sessionId);
      if (finished.completed) await refresh();
    }
    setPassage(false);
    setSession(null);
    setPage(target);
  };
  const navigate = (x: string) => {
    if (session?.current && session.selectedIndex === null) {
      alert("Submit the current answer before leaving this question.");
      return;
    }
    if (session) {
      void exitSession(x);
      return;
    }
    setPage(x);
  };
  return (
    <div className="shell">
      <header>
        <div className="brand">
          <span className="brandmark cross" role="img" aria-label="Cross" />
          <div>
            <b>BIBLE TRIVIA</b>
            <small>BIBLE STUDY</small>
          </div>
        </div>
        <nav>
          {nav.map(([id, label, I]) => (
            <button
              className={page === id ? "active" : ""}
              onClick={() => navigate(id)}
              key={id}
            >
              <I size={18} />
              {label}
              {id === "memorize" && dueCount > 0 && (
                <span className="due-badge">{dueCount}</span>
              )}
            </button>
          ))}
        </nav>
        <button className="profile-chip" onClick={() => navigate("profile")}>
          <span>{boot.animals.find((a) => a.id === p.avatarId)?.emoji}</span>
          <b>{p.name}</b>
          <small>Level {level.level}</small>
          <Flame size={17} />
          {p.currentStreak}
        </button>
      </header>
      <main>
        {session && page !== "bible" ? (
          <Quiz
            session={session}
            setSession={setSession}
            passage={passage}
            setPassage={setPassage}
            books={boot.books}
            refresh={refresh}
            exit={() => exitSession()}
          />
        ) : page === "home" ? (
          <Dashboard
            p={p}
            boot={boot}
            session={session}
            setPage={setPage}
            setSession={setSession}
            dueCount={dueCount}
          />
        ) : page === "quizzes" ? (
          <Chooser boot={boot} mode="full" setSession={setSession} />
        ) : page === "practice" ? (
          <Chooser boot={boot} mode="practice" setSession={setSession} />
        ) : page === "crosswords" ? (
          <CrosswordHub books={boot.books} />
        ) : page === "memorize" ? (
          <VerseTrainerHub dueCount={dueCount} onDueCountChange={setDueCount} />
        ) : page === "bible" ? (
          <Reader books={boot.books} />
        ) : page === "online" ? (
          <Online profile={p} books={boot.books} />
        ) : page === "medals" ? (
          <Medals books={boot.books} />
        ) : (
          <Profile p={p} boot={boot} refresh={refresh} />
        )}
      </main>
    </div>
  );
}
function ProfileGate({
  boot,
  refresh,
}: {
  boot: Bootstrap;
  refresh: () => void;
}) {
  const [name, setName] = useState(""),
    [avatar, setAvatar] = useState("lamb");
  type UpdateStatus={state:'checking'|'up-to-date'|'available'|'downloaded'|'error';version?:string};
  const [updateStatus,setUpdateStatus]=useState<UpdateStatus>({state:'checking'});
  useEffect(()=>{
    const started=Date.now();
    let timer:ReturnType<typeof setTimeout>|undefined;
    const show=(value:UpdateStatus)=>{
      const delay=value.state==='up-to-date'?Math.max(0,3000-(Date.now()-started)):0;
      if(timer)clearTimeout(timer);
      timer=setTimeout(()=>setUpdateStatus(value),delay);
    };
    const off=window.selah.onUpdateStatus(value=>show(value as UpdateStatus));
    void api<UpdateStatus>('update:status').then(show);
    void api<UpdateStatus>('update:check').then(show);
    return ()=>{off();if(timer)clearTimeout(timer)};
  },[]);
  const updateLabel=updateStatus.state==='checking'?'Checking for the latest update…':updateStatus.state==='up-to-date'?'Up to date':updateStatus.state==='available'?`Downloading update ${updateStatus.version??''}…`:updateStatus.state==='downloaded'?`Update ${updateStatus.version??''} ready`:'Update check unavailable';
  return (
    <div className="gate">
      <div className="gate-card">
        <span className="brandmark big cross" role="img" aria-label="Cross" />
        <h1>Welcome to Bible Trivia</h1>
        <p>A quiet place to read, learn, and remember.</p>
        <div className={`update-status ${updateStatus.state}`} role="status" aria-live="polite">
          {updateStatus.state==='checking'&&<span className="update-spinner" aria-hidden="true" />}
          {updateLabel}
        </div>
        {boot.profiles.length > 0 && (
          <div className="profiles">
            {boot.profiles.map((p) => (
              <button
                onClick={() => api("profile:select", p.id).then(refresh)}
                key={p.id}
              >
                {boot.animals.find((a) => a.id === p.avatarId)?.emoji} {p.name}
              </button>
            ))}
          </div>
        )}
        <hr />
        <h3>Create a local profile</h3>
        <input
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="animals">
          {boot.animals
            .filter((a) => a.unlockLevel === 1)
            .map((a) => (
              <button
                title={a.name}
                className={avatar === a.id ? "chosen" : ""}
                onClick={() => setAvatar(a.id)}
                key={a.id}
              >
                {a.emoji}
              </button>
            ))}
        </div>
        <button
          className="primary"
          disabled={!name.trim()}
          onClick={() =>
            api("profile:create", { name, avatarId: avatar }).then(refresh)
          }
        >
          Begin
        </button>
        <small>Stored only on this computer</small>
      </div>
    </div>
  );
}
function Dashboard({
  p,
  boot,
  session,
  setPage,
  setSession,
  dueCount,
}: {
  p: Profile;
  boot: Bootstrap;
  session: QuizState | null;
  setPage: (x: string) => void;
  setSession: (s: QuizState) => void;
  dueCount: number;
}) {
  const l = levelAt(p.xp);
  return (
    <>
      <section className="hero">
        <div>
          <span className="eyebrow">WELCOME BACK, {p.name.toUpperCase()}</span>
          <h1>
            Grow in wisdom,
            <br />
            <em>one passage at a time.</em>
          </h1>
          <p>
            Continue your journey through Scripture and strengthen what you
            remember.
          </p>
        </div>
        <div className="level-orb">
          <span>{boot.animals.find((a) => a.id === p.avatarId)?.emoji}</span>
          <b>LEVEL {l.level}</b>
        </div>
      </section>
      <section className="dashboard">
        <div className="daily card">
          <span className="eyebrow">TODAY'S DAILY QUESTION</span>
          <h2>A moment to reflect</h2>
          <p>
            One question, chosen for today. The passage opens after you commit
            your answer.
          </p>
          <button
            className="primary"
            onClick={() =>
              api<QuizState>("session:start", { mode: "daily" }).then(
                setSession,
              )
            }
          >
            Answer today's question
          </button>
        </div>
        <div className="stat card">
          <Flame />
          <strong>{p.currentStreak}</strong>
          <span>day streak</span>
          <small>Longest: {p.longestStreak}</small>
        </div>
        <div className="stat card">
          <strong>
            {Math.floor(l.into)} / {Math.ceil(l.needed)}
          </strong>
          <span>XP to next level</span>
          <div className="meter">
            <i style={{ width: `${(l.into / l.needed) * 100}%` }} />
          </div>
        </div>
        {session && !session.completed && (
          <div className="continue card">
            <span className="eyebrow">CONTINUE WHERE YOU LEFT OFF</span>
            <h3>{session.title}</h3>
            <p>
              {session.answered} of {session.total} answered
            </p>
            <button
              className="secondary"
              onClick={() => setSession({ ...session })}
            >
              Continue
            </button>
          </div>
        )}
        <div className="continue card">
          <span className="eyebrow">CROSSWORD OF THE DAY</span>
          <h3>Today's Bible Crossword</h3>
          <p>Fill-in-the-blank Bible crossword. Earns bonus XP when completed.</p>
          <button className="secondary" onClick={() => setPage("crosswords")}>
            Open Crossword
          </button>
        </div>
        {dueCount > 0 && (
          <div className="continue card" style={{ borderLeft: '3px solid #b65f39' }}>
            <span className="eyebrow">MEMORY REVIEW</span>
            <h3>{dueCount} verse{dueCount > 1 ? 's' : ''} due for review</h3>
            <p>Keep long-term recall strong with today's scheduled reviews.</p>
            <button className="secondary" onClick={() => setPage("memorize")}>
              Review Now
            </button>
          </div>
        )}
        <div className="continue card">
          <span className="eyebrow">READING</span>
          <h3>Open the Bible Reader</h3>
          <p>Read comfortably and save personal highlights.</p>
          <button className="secondary" onClick={() => setPage("bible")}>
            Open Bible
          </button>
        </div>
      </section>
    </>
  );
}
function Chooser({
  boot,
  mode,
  setSession,
}: {
  boot: Bootstrap;
  mode: "full" | "practice";
  setSession: (x: QuizState) => void;
}) {
  const [book, setBook] = useState(boot.books[0].id),
    [from, setFrom] = useState(1),
    [to, setTo] = useState(1);
  const b = boot.books.find((x) => x.id === book)!;
  return (
    <section className="page">
      <span className="eyebrow">
        {mode === "full" ? "BOOK MASTERY" : "FOCUSED STUDY"}
      </span>
      <h1>{mode === "full" ? "Full Book Quizzes" : "Practice a passage"}</h1>
      <p>
        {mode === "full"
          ? "Answer 15 randomly selected questions from one book, or every available question when the book has fewer than 15. Only these quizzes earn medals."
          : "Choose a chapter or range. Practice earns XP without affecting medals."}
      </p>
      <div className="form-card card">
        <label>
          Book
          <select
            value={book}
            onChange={(e) => {
              setBook(e.target.value);
              setFrom(1);
              setTo(1);
            }}
          >
            {boot.books.map((x) => (
              <option value={x.id} key={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        {mode === "practice" && (
          <div className="range">
            <label>
              From chapter
              <input
                type="number"
                min="1"
                max={b.chapters}
                value={from}
                onChange={(e) => setFrom(+e.target.value)}
              />
            </label>
            <label>
              Through
              <input
                type="number"
                min={from}
                max={b.chapters}
                value={to}
                onChange={(e) => setTo(+e.target.value)}
              />
            </label>
          </div>
        )}
        <button
          className="primary"
          onClick={() =>
            api<QuizState>("session:start", {
              mode,
              bookId: book,
              chapterStart: from,
              chapterEnd: to,
            })
              .then(setSession)
              .catch((e) => alert(e.message))
          }
        >
          Start {mode === "full" ? "full quiz" : "practice"}
        </button>
      </div>
    </section>
  );
}
function Quiz({
  session,
  setSession,
  passage,
  setPassage,
  books,
  refresh,
  exit,
}: {
  session: QuizState;
  setSession: (s: QuizState | null) => void;
  passage: boolean;
  setPassage: (x: boolean) => void;
  books: Book[];
  refresh: () => Promise<void>;
  exit: () => Promise<void>;
}) {
  const [selected, setSelected] = useState<number | null>(
    session.selectedIndex,
  );
  useEffect(
    () => setSelected(session.selectedIndex),
    [session.currentIndex, session.selectedIndex],
  );
  if (session.completed)
    return <Results session={session} close={() => void exit()} />;
  if (passage && session.current)
    return (
      <Reader
        books={books}
        initial={{
          bookId: session.current.bookId,
          chapter: session.current.chapter,
          from: session.current.verseStart,
          to: session.current.verseEnd,
        }}
        back={() => setPassage(false)}
      />
    );
  const q = session.current!;
  const submit = () =>
    api<QuizState>("session:answer", {
      sessionId: session.sessionId,
      selectedIndex: selected,
    }).then(setSession);
  const next = () =>
    api<QuizState>("session:next", session.sessionId).then((x) => {
      setPassage(false);
      setSession(x);
      if (x.completed) void refresh();
    });
  return (
    <section className="quiz">
      <div className="quiz-top">
        <div>
          <span className="eyebrow">{session.mode.toUpperCase()}</span>
          <h2>{session.title}</h2>
        </div>
        <span>
          {session.answered} / {session.total}
        </span>
      </div>
      <div className="meter">
        <i style={{ width: `${(session.answered / session.total) * 100}%` }} />
      </div>
      <article className="question card">
        <span className="reference">Question {session.currentIndex + 1}</span>
        <h1>{q.text}</h1>
        <div className="choices">
          {q.choices.map((c, i) => (
            <button
              disabled={session.selectedIndex !== null}
              className={`${selected === i ? "selected " : ""}${session.selectedIndex !== null ? (i === session.correctIndex ? "correct" : i === session.selectedIndex ? "wrong" : "") : ""}`}
              onClick={() => setSelected(i)}
              key={i}
            >
              <b>{"ABCD"[i]}</b>
              {c}
            </button>
          ))}
        </div>
        {session.selectedIndex === null ? (
          <button
            className="primary"
            disabled={selected === null}
            onClick={submit}
          >
            Submit answer
          </button>
        ) : (
          <div className={`feedback ${session.isCorrect ? "yes" : "no"}`}>
            <button
              className="feedback-close"
              aria-label="Close question results"
              title="Close"
              onClick={() => void exit()}
            >
              <X size={18} />
            </button>
            {session.isCorrect ? <CheckCircle2 /> : <XCircle />}
            <div>
              <b>{session.isCorrect ? "Correct" : "Not quite"}</b>
              <span>
                The correct answer is {q.choices[session.correctIndex!]}
              </span>
            </div>
            <button className="secondary" onClick={() => setPassage(true)}>
              View passage
            </button>
            <button className="primary" onClick={next}>
              {session.currentIndex + 1 === session.total
                ? "See results"
                : "Next question"}
            </button>
          </div>
        )}
      </article>
    </section>
  );
}
function Results({
  session,
  close,
}: {
  session: QuizState;
  close: () => void;
}) {
  const pct = session.total ? (session.correct / session.total) * 100 : 0,
    xp = session.total + session.correct,
    tier = medal(pct);
  return (
    <section className="results card">
      <span className="eyebrow">QUIZ COMPLETE</span>
      <h1>{session.title}</h1>
      <div
        className={`medal ${tier}`}
        aria-label={tier === "none" ? "No medal earned" : `${tier} medal`}
      >
        ✦
      </div>
      <h2>
        {session.correct} of {session.total} correct
      </h2>
      <strong>{pct.toFixed(1)}%</strong>
      {session.mode !== "daily" && (
        <>
          <p>+{xp} XP earned</p>
          <p className="medal-name">
            {tier === "none"
              ? "No medal earned — keep learning!"
              : `${tier.toUpperCase()} MEDAL`}
          </p>
        </>
      )}
      <button className="primary" onClick={close}>
        Done
      </button>
    </section>
  );
}
function LegacyReader({
  books,
  initial,
  back,
}: {
  books: Book[];
  initial?: { bookId: string; chapter: number; from: number; to: number };
  back?: () => void;
}) {
  const [bookId, setBook] = useState(initial?.bookId ?? "GEN"),
    [chapter, setChapter] = useState(initial?.chapter ?? 1),
    [verses, setVerses] = useState<Verse[]>([]);
  const book = books.find((b) => b.id === bookId)!;
  const load = () =>
    api<Verse[]>("bible:chapter", { bookId, chapter }).then(setVerses);
  useEffect(() => {
    load();
  }, [bookId, chapter]);
  const move = (d: number) => {
    let c = chapter + d,
      b = book;
    if (c < 1) {
      const prev = books[book.order - 2];
      if (!prev) return;
      b = prev;
      c = prev.chapters;
    } else if (c > b.chapters) {
      const next = books[book.order];
      if (!next) return;
      b = next;
      c = 1;
    }
    setBook(b.id);
    setChapter(c);
  };
  return (
    <section className="reader">
      {back && (
        <button className="back" onClick={back}>
          <ChevronLeft /> Back to quiz
        </button>
      )}
      <div className="reader-head">
        <div>
          <span className="eyebrow">WORLD ENGLISH BIBLE</span>
          <h1>
            {book.name} {chapter}
          </h1>
        </div>
        <div>
          <select
            value={bookId}
            onChange={(e) => {
              setBook(e.target.value);
              setChapter(1);
            }}
          >
            {books.map((b) => (
              <option value={b.id} key={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <select value={chapter} onChange={(e) => setChapter(+e.target.value)}>
            {Array.from({ length: book.chapters }, (_, i) => (
              <option key={i}>{i + 1}</option>
            ))}
          </select>
        </div>
      </div>
      {verses.length ? (
        <article className="scripture">
          {verses.map((v) => (
            <p
              className={
                initial && v.verse >= initial.from && v.verse <= initial.to
                  ? "temporary"
                  : ""
              }
              style={
                v.highlightColor
                  ? { background: `var(--${v.highlightColor})` }
                  : undefined
              }
              key={v.verse}
            >
              <sup>{v.verse}</sup>
              {v.text}
              <span className="highlights">
                {["yellow", "green", "blue", "pink", "purple"].map((c) => (
                  <button
                    aria-label={`Highlight ${c}`}
                    style={{ background: `var(--${c})` }}
                    onClick={() =>
                      api("highlight:set", {
                        bookId,
                        chapter,
                        verse: v.verse,
                        color: c,
                      }).then(load)
                    }
                    key={c}
                  />
                ))}
                <button
                  onClick={() =>
                    api("highlight:set", {
                      bookId,
                      chapter,
                      verse: v.verse,
                      color: null,
                    }).then(load)
                  }
                >
                  ×
                </button>
              </span>
            </p>
          ))}
        </article>
      ) : (
        <div className="empty card">
          <BookOpen />
          <h3>Text not imported yet</h3>
          <p>
            This clean V1 seed includes sample chapters. Run the WEB importer to
            populate all 66 books without changing user data.
          </p>
        </div>
      )}
      <div className="chapter-nav">
        <button onClick={() => move(-1)}>
          <ChevronLeft /> Previous
        </button>
        <button onClick={() => move(1)}>
          Next <ChevronRight />
        </button>
      </div>
    </section>
  );
}
function Medals({ books }: { books: Book[] }) {
  const [stats, setStats] = useState<any>(null);
  useEffect(() => {
    api("stats").then(setStats);
  }, []);
  const get = (id: string) => stats?.books.find((x: any) => x.book_id === id);
  return (
    <section className="page">
      <span className="eyebrow">BOOK MASTERY</span>
      <h1>Your medals</h1>
      {["OT", "NT"].map((t) => (
        <div key={t}>
          <h2>{t === "OT" ? "Old Testament" : "New Testament"}</h2>
          <div className="medal-grid">
            {books
              .filter((b) => b.testament === t)
              .map((b) => {
                const s = get(b.id),
                  m = medal(s?.best_percent ?? 0);
                return (
                  <div className="book-medal card" key={b.id}>
                    <span className={`mini-medal ${m}`}>✦</span>
                    <b>{b.name}</b>
                    <small>
                      {m === "none" ? "Not earned" : m} · {s?.attempts ?? 0}{" "}
                      attempts
                    </small>
                  </div>
                );
              })}
          </div>
        </div>
      ))}
    </section>
  );
}
function Profile({
  p,
  boot,
  refresh,
}: {
  p: Profile;
  boot: Bootstrap;
  refresh: () => Promise<void>;
}) {
  const [stats, setStats] = useState<any>(null);
  useEffect(() => {
    api("stats").then(setStats);
  }, []);
  const l = levelAt(p.xp),
    answered = stats?.full.answered ?? 0,
    correct = stats?.full.correct ?? 0;
  const choose = (id: string) =>
    api<Bootstrap>("profile:avatar", id)
      .then(refresh)
      .catch((e) => alert(e.message));
  return (
    <section className="page">
      <div className="profile-hero card">
        <span className="avatar-large">
          {boot.animals.find((a) => a.id === p.avatarId)?.emoji}
        </span>
        <div>
          <h1>{p.name}</h1>
          <p>
            Level {l.level} · {p.xp.toFixed(2)} lifetime XP
          </p>
          <div className="meter">
            <i style={{ width: `${(l.into / l.needed) * 100}%` }} />
          </div>
        </div>
      </div>
      <section className="avatar-picker card">
        <span className="eyebrow">CHOOSE YOUR AVATAR</span>
        <h2>Avatar collection</h2>
        <p>
          Select any avatar you have unlocked. Keep leveling up to reveal the
          rest.
        </p>
        <div className="avatar-grid">
          {boot.animals.map((a) => {
            const locked = l.level < a.unlockLevel,
              selected = p.avatarId === a.id;
            return (
              <button
                className={`${locked ? "locked " : ""}${selected ? "selected" : ""}`}
                disabled={locked}
                onClick={() => choose(a.id)}
                key={a.id}
                aria-label={
                  locked
                    ? `${a.name}, unlocks at level ${a.unlockLevel}`
                    : `Choose ${a.name}`
                }
              >
                <span>{a.emoji}</span>
                <b>{a.name}</b>
                <small>
                  {locked
                    ? `🔒 Unlocks at level ${a.unlockLevel}`
                    : selected
                      ? "Selected"
                      : "Unlocked"}
                </small>
              </button>
            );
          })}
        </div>
      </section>
      <div className="stats-grid">
        <div className="card stat">
          <Flame />
          <strong>{p.currentStreak}</strong>
          <span>Current streak</span>
          <small>Longest: {p.longestStreak}</small>
        </div>
        <div className="card stat">
          <strong>{stats?.full.completed ?? 0}</strong>
          <span>Full quizzes completed</span>
        </div>
        <div className="card stat">
          <strong>
            {answered ? `${((correct / answered) * 100).toFixed(1)}%` : "—"}
          </strong>
          <span>Full quiz accuracy</span>
          <small>
            {correct} correct · {answered - correct} incorrect
          </small>
        </div>
        <div className="card stat">
          <strong>{stats?.daily.answered ?? 0}</strong>
          <span>Daily questions</span>
          <small>{stats?.daily.correct ?? 0} correct</small>
        </div>
      </div>
    </section>
  );
}
function levelAt(xp: number) {
  let level = 1,
    into = xp,
    needed = 25;
  while (into + 1e-9 >= needed) {
    into -= needed;
    level++;
    needed = 25 * Math.pow(1.0003, level - 1);
  }
  return { level, into, needed };
}
try {
  if (!window.selah) throw new Error("The secure desktop bridge did not load.");
  createRoot(document.getElementById("root")!).render(<App />);
} catch (error) {
  const root = document.getElementById("root");
  if (root)
    root.innerHTML = `<main style="font-family:Segoe UI,sans-serif;padding:40px;color:#7b2d2d"><h1>Bible Trivia could not start</h1><p>${error instanceof Error ? error.message : String(error)}</p></main>`;
  console.error(error);
}
