import electron from 'electron';
const { app, BrowserWindow, ipcMain } = electron;
import path from 'node:path'; import fs from 'node:fs'; import Database from './db.js';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url'; import { ensureContent } from './content.js'; import { userMigrations } from './migrations.js'; import { fullQuizQuestions, levelFromXp, shuffled, streak, medalFor } from './domain.js';
import { readChapter, searchVerses } from './bible.js';
import { generateCrossword, selectClues, selectDailyClues, normalizeCrosswordAnswer } from './crossword.js';
import type { ClueRecord } from './crossword.js';
import { chunkText, compareAttempt, generateExercise, adaptLevel, updateWeakWords, scheduleNextReview, computeMastery, normalizeForComparison, tokenize } from './verse-trainer.js';
import type { WeakWord, PerformanceEntry } from './verse-trainer.js';
import electronUpdater from 'electron-updater';
const { autoUpdater } = electronUpdater;

// Keep the original storage location across the Bible Trivia rebrand so upgrades
// never strand existing offline profiles in a newly named Electron directory.
app.setPath('userData',path.join(app.getPath('appData'),'bible-questions-app'));
const here=path.dirname(fileURLToPath(import.meta.url)); let user:Database, content:Database, userDbPath=path.join(app.getPath('userData'),'selah-user.sqlite'); let activeProfileId:number|null=null; let lastInteraction=Date.now(), accrued=0;
const isoDay=()=>new Date().toLocaleDateString('en-CA'); const now=()=>new Date().toISOString();
function awardXp(profileId:number,amount:number,source:string){user.prepare('UPDATE profiles SET xp=xp+? WHERE id=?').run(amount,profileId);user.prepare('INSERT INTO xp_events(id,profile_id,amount,source,created_at) VALUES(?,?,?,?,?)').run(randomUUID(),profileId,amount,source,now());}
function configureAutoUpdates(win:InstanceType<typeof BrowserWindow>){
 type UpdateState={state:'checking'|'up-to-date'|'available'|'downloaded'|'error';version?:string};
 let status:UpdateState=app.isPackaged?{state:'checking'}:{state:'up-to-date'};
 let checking=false;
 const publish=(next:UpdateState)=>{status=next;if(!win.isDestroyed())win.webContents.send('update:status',status);};
 const check=async()=>{
  if(!app.isPackaged||checking)return status;
  checking=true;publish({state:'checking'});
  try{await autoUpdater.checkForUpdates();}catch{ /* The updater error event publishes the status. */ }
  finally{checking=false;}
  return status;
 };
 ipcMain.handle('update:status',()=>status);
 ipcMain.handle('update:check',()=>check());
 if(!app.isPackaged)return;
 autoUpdater.autoDownload=true;
 autoUpdater.autoInstallOnAppQuit=true;
 autoUpdater.on('checking-for-update',()=>publish({state:'checking'}));
 autoUpdater.on('update-available',info=>publish({state:'available',version:info.version}));
 autoUpdater.on('update-not-available',()=>publish({state:'up-to-date'}));
 autoUpdater.on('update-downloaded',async info=>{
  publish({state:'downloaded',version:info.version});
  const result=await electron.dialog.showMessageBox(win,{type:'info',title:'Update ready',message:`Bible Trivia ${info.version} is ready.`,detail:'Restart now to install it. Your profiles and progress will be preserved.',buttons:['Restart and update','Later'],defaultId:0,cancelId:1});
  if(result.response===0)autoUpdater.quitAndInstall(false,true);
 });
 autoUpdater.on('error',error=>{publish({state:'error'});console.error('Automatic update error:',error)});
 win.webContents.once('did-finish-load',()=>void check());
 setInterval(()=>void check(),60*60*1000);
}
function registerBibleSearch(){
 ipcMain.handle('bible:translations',()=>content.prepare('SELECT id,name,abbreviation,description,license FROM translations ORDER BY sort_order').all());
 ipcMain.handle('bible:search',(_,value)=>{
  const query=String(value?.query??value??'');
  const translationId=String(value?.translationId??'BSB');
  return searchVerses(content,translationId,query);
 });
 ipcMain.handle('reading-position:get',()=>{if(!activeProfileId)throw new Error('No profile');return user.prepare('SELECT book_id bookId,chapter FROM reading_positions WHERE profile_id=?').get(activeProfileId)??null;});
}
function registerAnnotations(){
 ipcMain.handle('note:set',(_,p)=>{if(!activeProfileId)throw new Error('No profile');const note=String(p.note??'').trim();if(note)user.prepare('INSERT INTO verse_notes VALUES(?,?,?,?,?,?) ON CONFLICT(profile_id,book_id,chapter,verse) DO UPDATE SET note=excluded.note,updated_at=excluded.updated_at').run(activeProfileId,p.bookId,p.chapter,p.verse,note,now());else user.prepare('DELETE FROM verse_notes WHERE profile_id=? AND book_id=? AND chapter=? AND verse=?').run(activeProfileId,p.bookId,p.chapter,p.verse);});
 ipcMain.handle('bookmark:toggle',(_,p)=>{if(!activeProfileId)throw new Error('No profile');const exists=user.prepare('SELECT 1 FROM bookmarks WHERE profile_id=? AND book_id=? AND chapter=? AND verse=?').get(activeProfileId,p.bookId,p.chapter,p.verse);if(exists)user.prepare('DELETE FROM bookmarks WHERE profile_id=? AND book_id=? AND chapter=? AND verse=?').run(activeProfileId,p.bookId,p.chapter,p.verse);else user.prepare('INSERT INTO bookmarks VALUES(?,?,?,?,?)').run(activeProfileId,p.bookId,p.chapter,p.verse,now());});
 ipcMain.handle('chapter-bookmark:list',()=>{if(!activeProfileId)throw new Error('No profile');return (user.prepare('SELECT color,book_id bookId,chapter FROM chapter_bookmarks WHERE profile_id=?').all(activeProfileId) as {color:string;bookId:string;chapter:number}[]).map(mark=>({...mark,bookName:(content.prepare('SELECT name FROM books WHERE id=?').get(mark.bookId) as {name:string}|undefined)?.name??mark.bookId}));});
 ipcMain.handle('chapter-bookmark:set',(_,p)=>{if(!activeProfileId)throw new Error('No profile');const allowed=new Set(['red','gold','green','blue','purple']);if(!allowed.has(String(p.color)))throw new Error('Invalid bookmark color.');const book=content.prepare('SELECT chapters FROM books WHERE id=?').get(String(p.bookId)) as {chapters:number}|undefined;if(!book||Number(p.chapter)<1||Number(p.chapter)>book.chapters)throw new Error('Invalid Bible location.');user.prepare('INSERT INTO chapter_bookmarks(profile_id,color,book_id,chapter,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(profile_id,color) DO UPDATE SET book_id=excluded.book_id,chapter=excluded.chapter,updated_at=excluded.updated_at').run(activeProfileId,p.color,p.bookId,p.chapter,now());});
 ipcMain.handle('chapter-bookmark:clear',(_,color)=>{if(!activeProfileId)throw new Error('No profile');user.prepare('DELETE FROM chapter_bookmarks WHERE profile_id=? AND color=?').run(activeProfileId,String(color));});
}
function migrate(db:Database){db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)'); const applied=new Set((db.prepare('SELECT version FROM schema_migrations').all() as unknown as {version:number}[]).map(x=>x.version)); userMigrations.forEach((sql,i)=>{if(!applied.has(i+1))db.transaction(()=>{db.exec(sql);db.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(i+1,now())})();});}
function profile(id:number){return user.prepare('SELECT id,name,avatar_id avatarId,xp,current_streak currentStreak,longest_streak longestStreak,last_active_date lastActiveDate,selected_banner selectedBanner FROM profiles WHERE id=?').get(id);}
function touch(id:number){const p:any=profile(id), s=streak(p.lastActiveDate,p.currentStreak,p.longestStreak,isoDay()); user.prepare('UPDATE profiles SET current_streak=?,longest_streak=?,last_active_date=? WHERE id=?').run(s.current,s.longest,isoDay(),id);}
function bootstrap(){const profiles=user.prepare('SELECT id,name,avatar_id avatarId,xp,current_streak currentStreak,longest_streak longestStreak,last_active_date lastActiveDate,selected_banner selectedBanner FROM profiles ORDER BY id').all(); if(activeProfileId&&!profiles.some((p:any)=>p.id===activeProfileId))activeProfileId=null; const books=content.prepare('SELECT id,name,testament,book_order `order`,chapters FROM books ORDER BY book_order').all(); const animals=content.prepare('SELECT id,name,emoji,unlock_level unlockLevel FROM animals ORDER BY sort_order').all(); return {profiles,activeProfile:activeProfileId?profile(activeProfileId):null,books,animals,appVersion:app.getVersion(),bankVersion:(content.prepare("SELECT value FROM metadata WHERE key='question_bank_version'").get() as any).value};}
function currentSession(id:number){const s:any=user.prepare("SELECT * FROM sessions WHERE profile_id=? AND status='active' ORDER BY id DESC LIMIT 1").get(id); return s?sessionState(s):null;}
function sessionState(s:any){const order:string[]=JSON.parse(s.question_order), choices:number[][]=JSON.parse(s.choice_orders), qid=order[s.current_index]; const raw:any=qid?content.prepare('SELECT q.*,b.name book_name FROM questions q JOIN books b ON b.id=q.book_id WHERE q.id=?').get(qid):null; const ans:any=raw?user.prepare('SELECT * FROM session_answers WHERE session_id=? AND question_id=?').get(s.id,qid):null; const totals:any=user.prepare('SELECT COUNT(*) answered,COALESCE(SUM(is_correct),0) correct FROM session_answers WHERE session_id=?').get(s.id); let current=null,correctIndex=null;if(raw){const vals=[raw.answer_a,raw.answer_b,raw.answer_c,raw.answer_d], map=choices[s.current_index];current={id:raw.id,bookId:raw.book_id,bookName:raw.book_name,chapter:raw.chapter,verseStart:raw.verse_start,verseEnd:raw.verse_end,text:raw.question_text,choices:map.map(i=>vals[i])};correctIndex=map.indexOf(raw.correct_index);} return {sessionId:s.id,mode:s.mode,bookId:s.book_id,title:s.title,currentIndex:s.current_index,total:order.length,answered:totals.answered,correct:totals.correct,completed:s.status==='completed',current,selectedIndex:ans?.selected_choice??null,correctIndex:ans?correctIndex:null,isCorrect:ans?!!ans.is_correct:null};}
function createSession(profileId:number,mode:string,bookId:string='',chapterStart:number=1,chapterEnd:number=chapterStart){
 let rows:any[];
 if(mode==='daily'){
   const date=isoDay();let d:any=user.prepare('SELECT question_id FROM daily_questions WHERE profile_id=? AND local_date=?').get(profileId,date);
   if(!d){const all=content.prepare('SELECT id FROM questions').all() as any[];
   // Deterministic by date only (not profile) so every user gets the same daily question.
   const picked=all[[...date].reduce((a,c)=>a+c.charCodeAt(0),0)%all.length];
   user.prepare('INSERT INTO daily_questions(profile_id,local_date,question_id) VALUES(?,?,?)').run(profileId,date,picked.id);d={question_id:picked.id};}
  rows=[{id:d.question_id}];
 }else{
  rows=content.prepare(`SELECT id FROM questions WHERE book_id=? ${mode==='practice'?'AND chapter BETWEEN ? AND ?':''}`).all(...(mode==='practice'?[bookId,chapterStart,chapterEnd]:[bookId])) as any[];
 }
 if(!rows.length)throw new Error('No questions are available for this selection yet.');
 const available=rows.map(x=>x.id);
 const ids=mode==='full'?fullQuizQuestions(available):shuffled(available);
 const maps=ids.map(()=>shuffled([0,1,2,3]));
 const name=(content.prepare('SELECT name FROM books WHERE id=?').get(bookId) as any)?.name;
 const title=mode==='daily'?"Today's Question":mode==='full'?`${name} — Full Quiz`:`${name} ${chapterStart===chapterEnd?'Chapter '+chapterStart:`Chapters ${chapterStart}–${chapterEnd}`}`;
 const info=user.prepare('INSERT INTO sessions(profile_id,mode,book_id,chapter_start,chapter_end,title,question_order,choice_orders,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(profileId,mode,bookId||null,chapterStart,chapterEnd,title,JSON.stringify(ids),JSON.stringify(maps),now());
 return sessionState(user.prepare('SELECT * FROM sessions WHERE id=?').get(info.lastInsertRowid));
}
function handlers(){ipcMain.handle('bootstrap',()=>bootstrap());ipcMain.handle('profile:create',(_,p)=>{const info=user.prepare('INSERT INTO profiles(name,avatar_id,created_at) VALUES(?,?,?)').run(String(p.name).trim().slice(0,40),p.avatarId,now());activeProfileId=Number(info.lastInsertRowid);touch(activeProfileId);return bootstrap();});ipcMain.handle('profile:select',(_,id)=>{activeProfileId=Number(id);touch(activeProfileId);return bootstrap();});ipcMain.handle('profile:current',()=>activeProfileId?profile(activeProfileId):null);ipcMain.handle('profile:avatar',(_,avatarId)=>{if(!activeProfileId)throw new Error('No profile');const animal:any=content.prepare('SELECT id,unlock_level FROM animals WHERE id=?').get(String(avatarId));if(!animal)throw new Error('Avatar not found.');const current:any=profile(activeProfileId);if(levelFromXp(current.xp).level<animal.unlock_level)throw new Error(`This avatar unlocks at level ${animal.unlock_level}.`);user.prepare('UPDATE profiles SET avatar_id=? WHERE id=?').run(animal.id,activeProfileId);return bootstrap();});
 ipcMain.handle('profile:link-online',(_,onlineUserId)=>{if(!activeProfileId)throw new Error('Select a local profile first.');const id=String(onlineUserId);user.transaction(()=>{user.prepare('UPDATE profiles SET online_user_id=NULL WHERE online_user_id=? AND id<>?').run(id,activeProfileId);user.prepare('UPDATE profiles SET online_user_id=? WHERE id=?').run(id,activeProfileId);})();return true;});
 ipcMain.handle('profile:sync-export',(_,onlineUserId)=>{
  if(!activeProfileId)throw new Error('Select a local profile first.');
  const linked=user.prepare('SELECT online_user_id FROM profiles WHERE id=?').get(activeProfileId) as {online_user_id:string|null}|undefined;
  if(linked?.online_user_id!==String(onlineUserId))throw new Error('This local profile is not linked to the signed-in account.');
  user.exec('PRAGMA wal_checkpoint(FULL)');
  const backupDir=path.join(path.dirname(userDbPath),'backups');fs.mkdirSync(backupDir,{recursive:true});
  const backupPath=path.join(backupDir,`selah-user-pre-sync-${Date.now()}.sqlite`);fs.copyFileSync(userDbPath,backupPath);
  const profileId=activeProfileId;
  const sessions=user.prepare('SELECT * FROM sessions WHERE profile_id=?').all(profileId) as {id:number}[];
  const sessionIds=sessions.map(item=>item.id);
  const sessionAnswers=sessionIds.length?user.prepare(`SELECT * FROM session_answers WHERE session_id IN (${sessionIds.map(()=>'?').join(',')})`).all(...sessionIds):[];
  return {schemaVersion:1,sourceDeviceId:`desktop-${process.platform}-${profileId}`,backupPath,exportedAt:now(),data:{
   profile:user.prepare('SELECT * FROM profiles WHERE id=?').get(profileId),sessions,sessionAnswers,
   bookStats:user.prepare('SELECT * FROM book_stats WHERE profile_id=?').all(profileId),
   highlights:user.prepare('SELECT * FROM highlights WHERE profile_id=?').all(profileId),
   readingPositions:user.prepare('SELECT * FROM reading_positions WHERE profile_id=?').all(profileId),
   dailyQuestions:user.prepare('SELECT * FROM daily_questions WHERE profile_id=?').all(profileId),
   unlockedBanners:user.prepare('SELECT * FROM unlocked_banners WHERE profile_id=?').all(profileId),
   verseNotes:user.prepare('SELECT * FROM verse_notes WHERE profile_id=?').all(profileId),
   bookmarks:user.prepare('SELECT * FROM bookmarks WHERE profile_id=?').all(profileId),
   chapterBookmarks:user.prepare('SELECT * FROM chapter_bookmarks WHERE profile_id=?').all(profileId)
  }};
 });
 ipcMain.handle('xp:sync-batch',(_,onlineUserId)=>{
  if(!activeProfileId)throw new Error('Select a local profile first.');
  const linked=user.prepare('SELECT online_user_id,xp FROM profiles WHERE id=?').get(activeProfileId) as {online_user_id:string|null;xp:number};
  if(linked.online_user_id!==String(onlineUserId))throw new Error('This local profile is not linked to the signed-in account.');
  const recorded=(user.prepare('SELECT COALESCE(SUM(amount),0) total FROM xp_events WHERE profile_id=?').get(activeProfileId) as {total:number}).total;
  const initial=Math.max(0,linked.xp-recorded);
  if(initial>0)user.prepare('INSERT INTO xp_events(id,profile_id,amount,source,created_at) VALUES(?,?,?,?,?)').run(randomUUID(),activeProfileId,initial,'initial-local-balance',now());
  return user.prepare('SELECT id,amount,source,created_at createdAt FROM xp_events WHERE profile_id=? AND synced_at IS NULL ORDER BY created_at').all(activeProfileId);
 });
 ipcMain.handle('xp:mark-synced',(_,ids)=>{if(!activeProfileId)return;const values=Array.isArray(ids)?ids.map(String):[];if(!values.length)return;user.prepare(`UPDATE xp_events SET synced_at=? WHERE profile_id=? AND id IN (${values.map(()=>'?').join(',')})`).run(now(),activeProfileId,...values);});
 ipcMain.handle('xp:apply-remote',(_,events)=>{if(!activeProfileId)throw new Error('Select a local profile first.');const insert=user.prepare('INSERT OR IGNORE INTO xp_events(id,profile_id,amount,source,created_at,synced_at) VALUES(?,?,?,?,?,?)');user.transaction(()=>{for(const event of events as {id:string;amount:number;source:string;createdAt:string}[]){const result=insert.run(event.id,activeProfileId,event.amount,event.source,event.createdAt,now());if(Number(result.changes)>0)user.prepare('UPDATE profiles SET xp=xp+? WHERE id=?').run(event.amount,activeProfileId);}})();return profile(activeProfileId);});
 ipcMain.handle('reader:sync-export',(_,onlineUserId)=>{if(!activeProfileId)throw new Error('Select a local profile first.');const linked=user.prepare('SELECT online_user_id FROM profiles WHERE id=?').get(activeProfileId) as {online_user_id:string|null};if(linked.online_user_id!==String(onlineUserId))throw new Error('This local profile is not linked to the signed-in account.');return {sourceDeviceId:`desktop-${process.platform}-${activeProfileId}`,snapshot:{highlights:user.prepare('SELECT book_id,chapter,verse,color,updated_at FROM highlights WHERE profile_id=?').all(activeProfileId),notes:user.prepare('SELECT book_id,chapter,verse,note,updated_at FROM verse_notes WHERE profile_id=?').all(activeProfileId),chapterBookmarks:user.prepare('SELECT color,book_id,chapter,updated_at FROM chapter_bookmarks WHERE profile_id=?').all(activeProfileId),readingPosition:user.prepare('SELECT book_id,chapter,updated_at FROM reading_positions WHERE profile_id=?').get(activeProfileId)??null,exportedAt:now()}};});
 ipcMain.handle('multiplayer:questions',(_,input)=>{const bookIds=Array.isArray(input?.bookIds)?input.bookIds.map(String):[];const count=Math.max(1,Math.min(20,Number(input?.count)||10));if(!bookIds.length)throw new Error('Select at least one Bible book.');const placeholders=bookIds.map(()=>'?').join(',');const rows=content.prepare(`SELECT q.id,q.book_id bookId,b.name bookName,q.chapter,q.verse_start verseStart,q.verse_end verseEnd,q.question_text text,q.answer_a answerA,q.answer_b answerB,q.answer_c answerC,q.answer_d answerD,q.correct_index correctIndex FROM questions q JOIN books b ON b.id=q.book_id WHERE q.book_id IN (${placeholders}) ORDER BY RANDOM() LIMIT ?`).all(...bookIds,count) as any[];if(rows.length<count)throw new Error(`Only ${rows.length} questions are available for those books. Choose more books or fewer questions.`);return rows.map(row=>({...row,choices:[row.answerA,row.answerB,row.answerC,row.answerD],answerA:undefined,answerB:undefined,answerC:undefined,answerD:undefined}));});
 ipcMain.handle('session:active',()=>activeProfileId?currentSession(activeProfileId):null);ipcMain.handle('session:start',(_,p)=>{if(!activeProfileId)throw new Error('Select a profile first.');return createSession(activeProfileId,p.mode,p.bookId,p.chapterStart,p.chapterEnd);});ipcMain.handle('session:answer',(_,p)=>{if(!activeProfileId)throw new Error('No profile');const s:any=user.prepare('SELECT * FROM sessions WHERE id=? AND profile_id=?').get(p.sessionId,activeProfileId);const state:any=sessionState(s);if(state.selectedIndex!==null)return state;const raw:any=content.prepare('SELECT correct_index FROM questions WHERE id=?').get(state.current.id);const maps=JSON.parse(s.choice_orders);const correct=maps[s.current_index].indexOf(raw.correct_index);const ok=p.selectedIndex===correct;
  // A daily question may be reopened, but its question XP is awarded only once.
  const priorDaily:any=s.mode==='daily'?user.prepare('SELECT answered_at FROM daily_questions WHERE profile_id=? AND local_date=?').get(activeProfileId,isoDay()):null;
  user.transaction(()=>{user.prepare('INSERT INTO session_answers VALUES(?,?,?,?,?,?)').run(s.id,state.current.id,p.selectedIndex,correct,ok?1:0,now());if(!priorDaily?.answered_at)awardXp(activeProfileId!,ok?2:1,'quiz-answer');if(s.mode==='daily'&&!priorDaily?.answered_at)user.prepare('UPDATE daily_questions SET selected_choice=?,correct_choice=?,is_correct=?,answered_at=? WHERE profile_id=? AND local_date=?').run(p.selectedIndex,correct,ok?1:0,now(),activeProfileId,isoDay());})();return sessionState(s);});
 ipcMain.handle('session:next',(_,id)=>{const s:any=user.prepare('SELECT * FROM sessions WHERE id=?').get(id);const st:any=sessionState(s);if(st.selectedIndex===null)throw new Error('Answer before continuing.');if(s.current_index+1>=st.total){user.transaction(()=>{user.prepare("UPDATE sessions SET status='completed',completed_at=? WHERE id=?").run(now(),id);if(s.mode==='full'){const pct=st.total?st.correct/st.total*100:0;user.prepare('INSERT INTO book_stats(profile_id,book_id,attempts,best_percent,last_question_count) VALUES(?,?,1,?,?) ON CONFLICT(profile_id,book_id) DO UPDATE SET attempts=attempts+1,best_percent=MAX(best_percent,excluded.best_percent),last_question_count=excluded.last_question_count').run(s.profile_id,s.book_id,pct,st.total);}})();return {...sessionState({...s,status:'completed'}),completed:true};}user.prepare('UPDATE sessions SET current_index=current_index+1 WHERE id=?').run(id);return sessionState(user.prepare('SELECT * FROM sessions WHERE id=?').get(id));});
 ipcMain.handle('bible:chapter',(_,p)=>{if(!activeProfileId)throw new Error('No profile');user.prepare('INSERT INTO reading_positions VALUES(?,?,?,?) ON CONFLICT(profile_id) DO UPDATE SET book_id=excluded.book_id,chapter=excluded.chapter,updated_at=excluded.updated_at').run(activeProfileId,p.bookId,p.chapter,now());return readChapter(content,user,activeProfileId,p.translationId??'BSB',p.bookId,p.chapter);});ipcMain.handle('highlight:set',(_,p)=>{if(!activeProfileId)throw new Error('No profile');if(p.color)user.prepare('INSERT INTO highlights VALUES(?,?,?,?,?,?) ON CONFLICT(profile_id,book_id,chapter,verse) DO UPDATE SET color=excluded.color,updated_at=excluded.updated_at').run(activeProfileId,p.bookId,p.chapter,p.verse,p.color,now());else user.prepare('DELETE FROM highlights WHERE profile_id=? AND book_id=? AND chapter=? AND verse=?').run(activeProfileId,p.bookId,p.chapter,p.verse);});
 ipcMain.handle('stats',()=>{if(!activeProfileId)return null;const books=(user.prepare('SELECT * FROM book_stats WHERE profile_id=?').all(activeProfileId) as any[]).map(book=>{const current=(content.prepare('SELECT COUNT(*) count FROM questions WHERE book_id=?').get(book.book_id) as {count:number}).count;const latest:any=book.last_question_count===null?user.prepare("SELECT question_order FROM sessions WHERE profile_id=? AND book_id=? AND mode='full' AND status='completed' ORDER BY completed_at DESC LIMIT 1").get(activeProfileId,book.book_id):null;const previous=book.last_question_count??(latest?JSON.parse(latest.question_order).length:null);return {...book,new_questions:previous===null?0:Math.max(0,current-previous)}});const full:any=user.prepare("SELECT COUNT(DISTINCT s.id) completed,COUNT(a.question_id) answered,COALESCE(SUM(a.is_correct),0) correct FROM sessions s LEFT JOIN session_answers a ON a.session_id=s.id WHERE s.profile_id=? AND s.mode='full' AND s.status='completed'").get(activeProfileId);const daily:any=user.prepare('SELECT COUNT(*) answered,COALESCE(SUM(is_correct),0) correct FROM daily_questions WHERE profile_id=? AND answered_at IS NOT NULL').get(activeProfileId);return {books,full,daily};});
 ipcMain.on('activity',()=>lastInteraction=Date.now());}

// ── XP constants (tune here) ────────────────────────────────────────────────
const XP={crosswordAnswer:1,crosswordBoardBonus:5,dailyCrosswordWord:2,dailyCrosswordBonus:10,verseExercise:1,verseFullRecall:5,verseReview:2} as const;

// ── Crossword handlers ──────────────────────────────────────────────────────
function registerCrossword(){
 function dbCluesForBook(bookId:string):ClueRecord[]{
  return (content.prepare('SELECT id,book_id bookId,clue_text clueText,answer,answer_normalized answerNormalized,reference FROM crossword_clues WHERE book_id=? AND enabled=1').all(bookId) as any[]).map((r:any)=>({id:r.id,bookId:r.bookId,clueText:r.clueText,answer:r.answer,answerNormalized:r.answerNormalized,reference:r.reference}));
 }
 function dbAllClues():ClueRecord[]{
  return (content.prepare('SELECT id,book_id bookId,clue_text clueText,answer,answer_normalized answerNormalized,reference FROM crossword_clues WHERE enabled=1').all() as any[]).map((r:any)=>({id:r.id,bookId:r.bookId,clueText:r.clueText,answer:r.answer,answerNormalized:r.answerNormalized,reference:r.reference}));
 }
 function buildBoardState(bookId:string,row:any,cluePool:ClueRecord[]){
  const clueIds:string[]=JSON.parse(row.clue_ids);
  const clues=clueIds.map((id:string)=>cluePool.find(c=>c.id===id)).filter(Boolean) as ClueRecord[];
  const layout=JSON.parse(row.grid_data);
  const letterState=JSON.parse(row.letter_state);
  const solvedWordNumbers=JSON.parse(row.solved_word_numbers);
  return {bookId,clues:clues.map(c=>({id:c.id,bookId:c.bookId,clueText:c.clueText,answer:c.answer,reference:c.reference})),layout,letterState,solvedWordNumbers,totalWords:layout.words.length};
 }
 ipcMain.handle('crossword:clues-for-book',(_,bookId)=>{
  if(!activeProfileId)throw new Error('No profile');
  const pool=dbCluesForBook(String(bookId));
  return {count:pool.length,sufficient:pool.length>=15};
 });
 ipcMain.handle('crossword:board-get',(_,bookId)=>{
  if(!activeProfileId)throw new Error('No profile');
  const row:any=user.prepare('SELECT * FROM crossword_boards WHERE profile_id=? AND book_id=?').get(activeProfileId,String(bookId));
  if(!row)return null;
  const pool=dbCluesForBook(String(bookId));
  return buildBoardState(String(bookId),row,pool);
 });
 ipcMain.handle('crossword:board-new',(_,bookId)=>{
  if(!activeProfileId)throw new Error('No profile');
  const bid=String(bookId);
  const pool=dbCluesForBook(bid);
  const recentRows=user.prepare('SELECT clue_id FROM crossword_history WHERE profile_id=? ORDER BY solved_at DESC LIMIT 60').all(activeProfileId) as {clue_id:string}[];
  const recentIds=recentRows.map(r=>r.clue_id);
  const selected=selectClues(pool,15,recentIds);
  if('error' in selected)throw new Error(`Not enough approved crossword clues for this book yet (${selected.available} available, 15 required).`);
  let layout=generateCrossword(selected);
  if(!layout){
   // Try a different random selection
   const alt=selectClues(pool,15,[]);
   if(!('error' in alt))layout=generateCrossword(alt);
  }
  if(!layout)throw new Error('Could not generate a crossword grid from the available clues. Try again or add more clues with varied letter intersections.');
  const clueIds=selected.map(c=>c.id);
  user.prepare('INSERT INTO crossword_boards(profile_id,book_id,clue_ids,grid_data,letter_state,solved_word_numbers,xp_awarded,created_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(profile_id,book_id) DO UPDATE SET clue_ids=excluded.clue_ids,grid_data=excluded.grid_data,letter_state=excluded.letter_state,solved_word_numbers=excluded.solved_word_numbers,xp_awarded=excluded.xp_awarded,created_at=excluded.created_at').run(activeProfileId,bid,JSON.stringify(clueIds),JSON.stringify(layout),'{}','[]',0,now());
  return buildBoardState(bid,{clue_ids:JSON.stringify(clueIds),grid_data:JSON.stringify(layout),letter_state:'{}',solved_word_numbers:'[]'},pool);
 });
 ipcMain.handle('crossword:board-save',(_,p)=>{
  if(!activeProfileId)throw new Error('No profile');
  user.prepare('UPDATE crossword_boards SET letter_state=?,solved_word_numbers=? WHERE profile_id=? AND book_id=?').run(JSON.stringify(p.letterState),JSON.stringify(p.solvedWordNumbers),activeProfileId,String(p.bookId));
 });
 ipcMain.handle('crossword:board-solve-word',(_,p)=>{
  if(!activeProfileId)throw new Error('No profile');
  const row:any=user.prepare('SELECT solved_word_numbers,clue_ids,xp_awarded FROM crossword_boards WHERE profile_id=? AND book_id=?').get(activeProfileId,String(p.bookId));
  if(!row)throw new Error('No active board');
  const solved:number[]=JSON.parse(row.solved_word_numbers);
  const wnum=Number(p.wordNumber);
  if(solved.includes(wnum))return;
  solved.push(wnum);
  user.transaction(()=>{
   user.prepare('UPDATE crossword_boards SET solved_word_numbers=? WHERE profile_id=? AND book_id=?').run(JSON.stringify(solved),activeProfileId,String(p.bookId));
   // Track clue as solved in history
   if(p.clueId)user.prepare('INSERT OR REPLACE INTO crossword_history(profile_id,clue_id,solved_at) VALUES(?,?,?)').run(activeProfileId,String(p.clueId),now());
   awardXp(activeProfileId!,XP.crosswordAnswer,'crossword-answer');
  })();
  // Board complete bonus (once per board)
  const clueIds:string[]=JSON.parse(row.clue_ids);
  const pool=dbCluesForBook(String(p.bookId));
  const layout=JSON.parse(user.prepare('SELECT grid_data FROM crossword_boards WHERE profile_id=? AND book_id=?').get(activeProfileId,String(p.bookId)) as any).grid_data?? '{"words":[]}';
  // We need the total words to check completion — re-read
  const freshRow:any=user.prepare('SELECT grid_data,solved_word_numbers,xp_awarded FROM crossword_boards WHERE profile_id=? AND book_id=?').get(activeProfileId,String(p.bookId));
  const totalWords=JSON.parse(freshRow.grid_data).words.length;
  const nowSolved:number[]=JSON.parse(freshRow.solved_word_numbers);
  if(nowSolved.length>=totalWords&&!freshRow.xp_awarded){
   user.transaction(()=>{
    awardXp(activeProfileId!,XP.crosswordBoardBonus,'crossword-board-complete');
    user.prepare('UPDATE crossword_boards SET xp_awarded=1 WHERE profile_id=? AND book_id=?').run(activeProfileId,String(p.bookId));
    user.prepare('INSERT INTO crossword_book_stats(profile_id,book_id,boards_completed) VALUES(?,?,1) ON CONFLICT(profile_id,book_id) DO UPDATE SET boards_completed=boards_completed+1').run(activeProfileId,String(p.bookId));
   })();
  }
 });
 ipcMain.handle('crossword:book-stats',(_,bookId)=>{
  if(!activeProfileId)throw new Error('No profile');
  const bid=String(bookId);
  const stats:any=user.prepare('SELECT boards_completed FROM crossword_book_stats WHERE profile_id=? AND book_id=?').get(activeProfileId,bid)??{boards_completed:0};
  const uniqueSolved=(user.prepare('SELECT COUNT(*) count FROM crossword_history WHERE profile_id=? AND (clue_id LIKE ? OR clue_id LIKE ?)').get(activeProfileId,'CROSS-'+bid+'-%',bid+'-%') as any).count;
  const totalClues=(content.prepare('SELECT COUNT(*) count FROM crossword_clues WHERE book_id=? AND enabled=1').get(bid) as any).count;
  return {boardsCompleted:stats.boards_completed,uniqueCluesSolved:uniqueSolved,totalClues};
 });
 // Daily crossword — deterministic by date, global across profiles
 ipcMain.handle('crossword:daily-get',()=>{
  if(!activeProfileId)throw new Error('No profile');
  const date=isoDay();
  const existing:any=user.prepare('SELECT * FROM daily_crossword WHERE profile_id=? AND local_date=?').get(activeProfileId,date);
  if(existing)return buildBoardState('daily',{...existing,book_id:'daily'},dbAllClues());
  // Create today's daily board
  const pool=dbAllClues();
  const selected=selectDailyClues(pool,date,Math.min(5,pool.length>=5?5:pool.length>=3?3:pool.length));
  if('error' in selected||selected.length<3)return null; // not enough clues yet
  let layout=generateCrossword(selected as ClueRecord[]);
  if(!layout)return null;
  const clueIds=(selected as ClueRecord[]).map(c=>c.id);
  user.prepare('INSERT INTO daily_crossword(profile_id,local_date,clue_ids,grid_data,letter_state,solved_word_numbers,completed,xp_awarded) VALUES(?,?,?,?,?,?,0,0)').run(activeProfileId,date,JSON.stringify(clueIds),JSON.stringify(layout),'{}','[]');
  return buildBoardState('daily',{clue_ids:JSON.stringify(clueIds),grid_data:JSON.stringify(layout),letter_state:'{}',solved_word_numbers:'[]'},pool);
 });
 ipcMain.handle('crossword:daily-save',(_,p)=>{
  if(!activeProfileId)throw new Error('No profile');
  const date=isoDay();
  user.prepare('UPDATE daily_crossword SET letter_state=?,solved_word_numbers=? WHERE profile_id=? AND local_date=?').run(JSON.stringify(p.letterState),JSON.stringify(p.solvedWordNumbers),activeProfileId,date);
 });
 ipcMain.handle('crossword:daily-solve-word',(_,p)=>{
  if(!activeProfileId)throw new Error('No profile');
  const date=isoDay();
  const row:any=user.prepare('SELECT * FROM daily_crossword WHERE profile_id=? AND local_date=?').get(activeProfileId,date);
  if(!row)throw new Error('No daily crossword');
  const solved:number[]=JSON.parse(row.solved_word_numbers);
  const wnum=Number(p.wordNumber);
  if(solved.includes(wnum))return;
  solved.push(wnum);
  const pool=dbAllClues();
  const totalWords=JSON.parse(row.grid_data).words.length;
  user.transaction(()=>{
   user.prepare('UPDATE daily_crossword SET solved_word_numbers=? WHERE profile_id=? AND local_date=?').run(JSON.stringify(solved),activeProfileId,date);
   if(p.clueId)user.prepare('INSERT OR REPLACE INTO crossword_history(profile_id,clue_id,solved_at) VALUES(?,?,?)').run(activeProfileId,String(p.clueId),now());
   awardXp(activeProfileId!,XP.dailyCrosswordWord,'daily-crossword-word');
   if(solved.length>=totalWords&&!row.xp_awarded){
    awardXp(activeProfileId!,XP.dailyCrosswordBonus,'daily-crossword-complete');
    user.prepare('UPDATE daily_crossword SET completed=1,xp_awarded=1 WHERE profile_id=? AND local_date=?').run(activeProfileId,date);
   }
  })();
 });
}

// ── Verse trainer handlers ──────────────────────────────────────────────────
function registerVerseTrainer(){
 function getVerse(id:number):any{
  const v:any=user.prepare('SELECT * FROM memory_verses WHERE id=?').get(id);
  if(!v)return null;
  const t:any=user.prepare('SELECT * FROM memory_training WHERE verse_id=?').get(id)??{difficulty_level:1,chunks:'[]',current_chunk_index:0,weak_words:'[]',performance_log:'[]'};
  const r:any=user.prepare('SELECT * FROM memory_reviews WHERE verse_id=?').get(id)??{mastery:'learning',next_review_date:null,last_reviewed:null,review_interval_days:0,successful_reviews:0,total_reviews:0};
  return {...v,...t,...r};
 }
 function ensureTraining(verseId:number,masterText:string){
  const exists=user.prepare('SELECT verse_id FROM memory_training WHERE verse_id=?').get(verseId);
  if(!exists){
   const chunks=chunkText(masterText);
   user.prepare('INSERT INTO memory_training(verse_id,difficulty_level,chunks,current_chunk_index,weak_words,performance_log) VALUES(?,1,?,0,?,?)').run(verseId,JSON.stringify(chunks),'[]','[]');
   user.prepare('INSERT INTO memory_reviews(verse_id,mastery,next_review_date,last_reviewed,review_interval_days,successful_reviews,total_reviews) VALUES(?,?,NULL,NULL,0,0,0)').run(verseId,'learning');
  }
 }
 ipcMain.handle('memory:list',()=>{
  if(!activeProfileId)throw new Error('No profile');
  const verses=user.prepare('SELECT v.*,t.difficulty_level,t.current_chunk_index,r.mastery,r.next_review_date,r.last_reviewed,r.review_interval_days,r.successful_reviews,r.total_reviews FROM memory_verses v LEFT JOIN memory_training t ON t.verse_id=v.id LEFT JOIN memory_reviews r ON r.verse_id=v.id WHERE v.profile_id=? ORDER BY v.created_at DESC').all(activeProfileId);
  return verses;
 });
 ipcMain.handle('memory:due-count',()=>{
  if(!activeProfileId)return 0;
  const today=isoDay();
  const count=(user.prepare('SELECT COUNT(*) cnt FROM memory_reviews r JOIN memory_verses v ON v.id=r.verse_id WHERE v.profile_id=? AND r.next_review_date IS NOT NULL AND r.next_review_date<=?').get(activeProfileId,today) as any).cnt;
  return count;
 });
 ipcMain.handle('memory:add',(_,p)=>{
  if(!activeProfileId)throw new Error('No profile');
  const ref=String(p.reference??'').trim();
  const text=String(p.masterText??'').trim();
  if(!ref||!text)throw new Error('Reference and verse text are required.');
  if(text.length>5000)throw new Error('Verse text is too long (max 5000 characters).');
  const t=now();
  const info=user.prepare('INSERT INTO memory_verses(profile_id,reference,translation,master_text,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(activeProfileId,ref,p.translation??null,text,t,t);
  const verseId=Number(info.lastInsertRowid);
  ensureTraining(verseId,text);
  return getVerse(verseId);
 });
 ipcMain.handle('memory:get',(_,id)=>{
  if(!activeProfileId)throw new Error('No profile');
  const v=getVerse(Number(id));
  if(!v||v.profile_id!==activeProfileId)throw new Error('Verse not found.');
  ensureTraining(v.id,v.master_text);
  return getVerse(Number(id));
 });
 ipcMain.handle('memory:update-text',(_,p)=>{
  if(!activeProfileId)throw new Error('No profile');
  const v:any=user.prepare('SELECT * FROM memory_verses WHERE id=? AND profile_id=?').get(Number(p.id),activeProfileId);
  if(!v)throw new Error('Verse not found.');
  const newText=String(p.masterText??'').trim();
  const newRef=String(p.reference??v.reference).trim();
  if(!newText)throw new Error('Verse text cannot be empty.');
  const textChanged=newText!==v.master_text;
  user.prepare('UPDATE memory_verses SET reference=?,master_text=?,translation=?,updated_at=? WHERE id=?').run(newRef,newText,p.translation??v.translation,now(),v.id);
  if(textChanged){
   // Reset training state since the text no longer matches learned performance
   const chunks=chunkText(newText);
   user.prepare('UPDATE memory_training SET difficulty_level=1,chunks=?,current_chunk_index=0,weak_words=?,performance_log=? WHERE verse_id=?').run(JSON.stringify(chunks),'[]','[]',v.id);
  }
  return getVerse(v.id);
 });
 ipcMain.handle('memory:delete',(_,id)=>{
  if(!activeProfileId)throw new Error('No profile');
  const v:any=user.prepare('SELECT id FROM memory_verses WHERE id=? AND profile_id=?').get(Number(id),activeProfileId);
  if(!v)throw new Error('Verse not found.');
  user.prepare('DELETE FROM memory_verses WHERE id=?').run(v.id); // cascades to training+reviews
 });
 ipcMain.handle('memory:exercise',(_,id)=>{
  if(!activeProfileId)throw new Error('No profile');
  const v=getVerse(Number(id));
  if(!v||v.profile_id!==activeProfileId)throw new Error('Verse not found.');
  ensureTraining(v.id,v.master_text);
  const fresh=getVerse(v.id);
  const chunks=JSON.parse(fresh.chunks);
  const level=fresh.difficulty_level??1;
  const currentChunk=fresh.current_chunk_index??0;
  const weakWords:WeakWord[]=JSON.parse(fresh.weak_words??'[]');
  // Determine active chunk indices based on level and current position
  let activeIndices:number[];
  if(level<=6){activeIndices=[currentChunk];}
  else if(level===7){activeIndices=currentChunk>0?[currentChunk-1,currentChunk]:[0];}
  else{activeIndices=chunks.map((_:any,i:number)=>i);}
  const exercise=generateExercise(chunks,activeIndices,level,weakWords);
  return {exercise,chunks,level,currentChunk,weakWords};
 });
 ipcMain.handle('memory:submit',(_,p)=>{
  if(!activeProfileId)throw new Error('No profile');
  const v=getVerse(Number(p.id));
  if(!v||v.profile_id!==activeProfileId)throw new Error('Verse not found.');
  ensureTraining(v.id,v.master_text);
  const fresh=getVerse(v.id);
  const chunks=JSON.parse(fresh.chunks);
  const level=fresh.difficulty_level??1;
  const currentChunk=fresh.current_chunk_index??0;
  const weakWords:WeakWord[]=JSON.parse(fresh.weak_words??'[]');
  // Determine the expected text for this exercise
  let expectedText:string;
  if(level<=6){expectedText=chunks[currentChunk]?.text??'';}
  else if(level===7){expectedText=(currentChunk>0?[chunks[currentChunk-1],chunks[currentChunk]]:[chunks[0]]).filter(Boolean).map((c:any)=>c.text).join(' ');}
  else{expectedText=v.master_text;}
  const attempt=String(p.attempt??'');
  let result;
  if(level<=1){
   result={
    score:1,
    correct:tokenize(normalizeForComparison(expectedText)),
    typos:[],
    missing:[],
    wrong:[],
    extra:[],
    reordered:false,
    passed:true,
   };
  }else{
   result=compareAttempt(expectedText,attempt);
  }
  const log:PerformanceEntry[]=JSON.parse(fresh.performance_log??'[]');
  log.push({level,score:result.score,timestamp:Date.now(),passed:result.passed});
  // Keep log manageable
  if(log.length>20)log.splice(0,log.length-20);
  const newLevel=adaptLevel(level,log);
  const newWeakWords=updateWeakWords(weakWords,result);
  // Advance chunk when passing at level 6+ 
  let newChunk=currentChunk;
  if(result.passed&&level>=6&&currentChunk<chunks.length-1){
   // Only advance chunk when the user has mastered this one at chunk-recall level
   if(level===6)newChunk=Math.min(currentChunk+1,chunks.length-1);
  }
  user.prepare('UPDATE memory_training SET difficulty_level=?,current_chunk_index=?,weak_words=?,performance_log=? WHERE verse_id=?').run(newLevel,newChunk,JSON.stringify(newWeakWords),JSON.stringify(log),v.id);
  // Award XP (once per exercise submission — cannot farm)
  if(result.passed){
   const isFullRecall=level>=8||chunks.length<=1;
   awardXp(activeProfileId!,isFullRecall?XP.verseFullRecall:XP.verseExercise,'verse-exercise');
  }
  return {result,newLevel,passed:result.passed};
 });
 ipcMain.handle('memory:review-list',()=>{
  if(!activeProfileId)throw new Error('No profile');
  const today=isoDay();
  return user.prepare('SELECT v.*,r.mastery,r.next_review_date,r.review_interval_days,r.successful_reviews,r.total_reviews FROM memory_verses v JOIN memory_reviews r ON r.verse_id=v.id WHERE v.profile_id=? AND r.next_review_date IS NOT NULL AND r.next_review_date<=? ORDER BY r.next_review_date').all(activeProfileId,today);
 });
 ipcMain.handle('memory:complete-review',(_,p)=>{
  if(!activeProfileId)throw new Error('No profile');
  const v:any=user.prepare('SELECT * FROM memory_verses WHERE id=? AND profile_id=?').get(Number(p.id),activeProfileId);
  if(!v)throw new Error('Verse not found.');
  const r:any=user.prepare('SELECT * FROM memory_reviews WHERE verse_id=?').get(v.id);
  if(!r)throw new Error('No review record.');
  const score=Number(p.score??0);
  const {nextReviewDate,newIntervalDays}=scheduleNextReview(score,r.review_interval_days,r.successful_reviews,r.total_reviews);
  const passed=score>=0.85;
  const newSuccessful=passed?r.successful_reviews+1:r.successful_reviews;
  const newTotal=r.total_reviews+1;
  // Compute days since created
  const created=new Date(v.created_at);
  const daysSinceCreated=Math.max(0,Math.floor((Date.now()-created.getTime())/86400000));
  const mastery=computeMastery(newSuccessful,daysSinceCreated,Math.max(r.review_interval_days,newIntervalDays));
  user.prepare('UPDATE memory_reviews SET mastery=?,next_review_date=?,last_reviewed=?,review_interval_days=?,successful_reviews=?,total_reviews=? WHERE verse_id=?').run(mastery,nextReviewDate,isoDay(),newIntervalDays,newSuccessful,newTotal,v.id);
  if(passed)awardXp(activeProfileId!,XP.verseReview,'verse-review');
  return getVerse(v.id);
 });
}

app.whenReady().then(()=>{const data=app.getPath('userData');fs.mkdirSync(data,{recursive:true});user=new Database(path.join(data,'selah-user.sqlite'));user.pragma('foreign_keys=ON');user.pragma('journal_mode=WAL');migrate(user);const resourceRoot=app.isPackaged?process.resourcesPath:process.cwd();content=ensureContent(path.join(data,'selah-content.sqlite'),[{translationId:'BSB',file:path.join(resourceRoot,'content','engbsb_vpl.txt')},{translationId:'WEB',file:path.join(resourceRoot,'content','engwebp_vpl.txt')},{translationId:'KJV',file:path.join(resourceRoot,'content','engkjv_vpl.txt')}]);handlers();registerBibleSearch();registerAnnotations();registerCrossword();registerVerseTrainer();setInterval(()=>{if(activeProfileId&&Date.now()-lastInteraction<300000){accrued+=5;if(accrued>=60){user.prepare('UPDATE profiles SET xp=xp+0.08,active_seconds=active_seconds+60 WHERE id=?').run(activeProfileId);accrued-=60;}}},5000);const win=new BrowserWindow({width:1280,height:820,minWidth:900,minHeight:650,title:'Bible Trivia',backgroundColor:'#f5f0e6',webPreferences:{preload:path.join(app.getAppPath(),'electron','preload.cjs'),contextIsolation:true,nodeIntegration:false}});configureAutoUpdates(win);if(process.env.VITE_DEV_SERVER_URL)win.loadURL(process.env.VITE_DEV_SERVER_URL);else win.loadFile(path.join(app.getAppPath(),'dist','index.html'));});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});

