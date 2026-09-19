import {describe,expect,it} from 'vitest';
import Database from './db.js';
import {userMigrations} from './migrations.js';

describe('user database migrations',()=>{
 it('upgrades a fresh profile database with notes and five chapter bookmark slots',()=>{
  const db=new Database(':memory:');
  userMigrations.forEach(sql=>db.exec(sql));
  const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as unknown as {name:string}[];
  expect(tables.map(item=>item.name)).toEqual(expect.arrayContaining(['profiles','highlights','verse_notes','bookmarks','chapter_bookmarks']));
  const bookStatColumns=db.prepare('PRAGMA table_info(book_stats)').all() as unknown as {name:string}[];
  expect(bookStatColumns.map(column=>column.name)).toContain('last_question_count');
  const profile=Number(db.prepare("INSERT INTO profiles(name,avatar_id,created_at) VALUES('Reader','lamb','now')").run().lastInsertRowid);
  db.prepare("INSERT INTO chapter_bookmarks VALUES(?,?,?,?,?)").run(profile,'red','GEN',1,'first');
  db.prepare("INSERT INTO chapter_bookmarks VALUES(?,?,?,?,?) ON CONFLICT(profile_id,color) DO UPDATE SET book_id=excluded.book_id,chapter=excluded.chapter,updated_at=excluded.updated_at").run(profile,'red','JHN',3,'second');
  expect(db.prepare('SELECT color,book_id bookId,chapter FROM chapter_bookmarks').all()).toEqual([{color:'red',bookId:'JHN',chapter:3}]);
  db.close();
 });
 it('creates crossword and verse trainer tables in the user database',()=>{
  const db=new Database(':memory:');
  userMigrations.forEach(sql=>db.exec(sql));
  const tables=(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as unknown as {name:string}[]).map(t=>t.name);
  // Crossword tables
  expect(tables).toContain('crossword_boards');
  expect(tables).toContain('crossword_history');
  expect(tables).toContain('crossword_book_stats');
  expect(tables).toContain('daily_crossword');
  // Verse trainer tables
  expect(tables).toContain('memory_verses');
  expect(tables).toContain('memory_training');
  expect(tables).toContain('memory_reviews');
  // Verify memory_training FK cascade setup works
  const profile=Number(db.prepare("INSERT INTO profiles(name,avatar_id,created_at) VALUES('Test','lamb','now')").run().lastInsertRowid);
  const verseId=Number(db.prepare("INSERT INTO memory_verses(profile_id,reference,master_text,created_at,updated_at) VALUES(?,?,'John 3:16 text','now','now')").run(profile,'John 3:16').lastInsertRowid);
  db.prepare('INSERT INTO memory_training(verse_id) VALUES(?)').run(verseId);
  db.prepare('INSERT INTO memory_reviews(verse_id) VALUES(?)').run(verseId);
  expect((db.prepare('SELECT COUNT(*) count FROM memory_training WHERE verse_id=?').get(verseId) as {count:number}).count).toBe(1);
  db.prepare('DELETE FROM memory_verses WHERE id=?').run(verseId);
  expect((db.prepare('SELECT COUNT(*) count FROM memory_training WHERE verse_id=?').get(verseId) as {count:number}).count).toBe(0);
  db.close();
 });
});

