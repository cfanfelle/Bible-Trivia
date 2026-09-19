import { describe, expect, it } from 'vitest';
import { ensureContent } from './content.js';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import Database from './db.js';

describe('content database seeding', () => {
  it('creates the curated question bank with the reviewed Genesis, Exodus, and Acts questions', () => {
    const db = ensureContent(':memory:');
    expect((db.prepare('SELECT COUNT(*) count FROM questions').get() as {count:number}).count).toBe(178);
    expect((db.prepare("SELECT COUNT(*) count FROM questions WHERE book_id='GEN'").get() as {count:number}).count).toBe(85);
    expect((db.prepare("SELECT COUNT(*) count FROM questions WHERE book_id<>'GEN'").get() as {count:number}).count).toBe(93);
    expect((db.prepare("SELECT answer_b,correct_index FROM questions WHERE id='GEN-000001'").get() as {answer_b:string;correct_index:number})).toEqual({answer_b:'Land and seas',correct_index:1});
    expect((db.prepare("SELECT answer_b,correct_index FROM questions WHERE id='GEN-000021'").get() as {answer_b:string;correct_index:number})).toEqual({answer_b:'An olive leaf',correct_index:1});
    expect((db.prepare("SELECT answer_c,correct_index FROM questions WHERE id='GEN-000035'").get() as {answer_c:string;correct_index:number})).toEqual({answer_c:'Abraham was 99 and Ishmael was 13',correct_index:2});
    expect(db.prepare("SELECT id,correct_index correctIndex FROM questions WHERE id BETWEEN 'GEN-000043' AND 'GEN-000047' ORDER BY id").all()).toEqual([
      {id:'GEN-000043',correctIndex:0}, {id:'GEN-000044',correctIndex:2}, {id:'GEN-000045',correctIndex:1},
      {id:'GEN-000046',correctIndex:1}, {id:'GEN-000047',correctIndex:1}
    ]);
    expect(db.prepare("SELECT id,correct_index correctIndex FROM questions WHERE id BETWEEN 'GEN-000048' AND 'GEN-000053' ORDER BY id").all()).toEqual([
      {id:'GEN-000048',correctIndex:1}, {id:'GEN-000049',correctIndex:1}, {id:'GEN-000050',correctIndex:2},
      {id:'GEN-000051',correctIndex:1}, {id:'GEN-000052',correctIndex:1}, {id:'GEN-000053',correctIndex:2}
    ]);
    expect(db.prepare("SELECT id,correct_index correctIndex FROM questions WHERE id BETWEEN 'GEN-000054' AND 'GEN-000056' ORDER BY id").all()).toEqual([
      {id:'GEN-000054',correctIndex:0}, {id:'GEN-000055',correctIndex:1}, {id:'GEN-000056',correctIndex:1}
    ]);
    expect(db.prepare("SELECT book_id bookId,correct_index correctIndex FROM questions WHERE id IN ('GEN-000037','PRO-000001','ISA-000001','MAT-000001','JOS-000001','NUM-000001') ORDER BY id").all()).toEqual([
      {bookId:'GEN',correctIndex:1}, {bookId:'ISA',correctIndex:3}, {bookId:'JOS',correctIndex:0},
      {bookId:'MAT',correctIndex:0}, {bookId:'NUM',correctIndex:3}, {bookId:'PRO',correctIndex:1}
    ]);
    db.close();
  });
  it('offers three starter avatars and evenly spaced unlocks ending with the lion at level 1000', () => {
    const db=ensureContent(':memory:');
    expect(db.prepare('SELECT id,unlock_level unlockLevel FROM animals ORDER BY sort_order').all()).toEqual([
      {id:'lamb',unlockLevel:1},
      {id:'dove',unlockLevel:1},
      {id:'fish',unlockLevel:1},
      {id:'donkey',unlockLevel:50},
      {id:'goat',unlockLevel:208},
      {id:'camel',unlockLevel:367},
      {id:'eagle',unlockLevel:525},
      {id:'deer',unlockLevel:683},
      {id:'ox',unlockLevel:842},
      {id:'lion',unlockLevel:1000}
    ]);
    db.close();
  });
  it('imports three complete offline, public-domain Bible translations', () => {
    const contentDir=path.join(process.cwd(),'content');
    const db=ensureContent(':memory:',[
      {translationId:'BSB',file:path.join(contentDir,'engbsb_vpl.txt')},
      {translationId:'WEB',file:path.join(contentDir,'engwebp_vpl.txt')},
      {translationId:'KJV',file:path.join(contentDir,'engkjv_vpl.txt')}
    ]);
    expect(db.prepare('SELECT translation_id,COUNT(*) count FROM verses GROUP BY translation_id ORDER BY translation_id').all()).toEqual([
      {translation_id:'BSB',count:31086},
      {translation_id:'KJV',count:31102},
      {translation_id:'WEB',count:31103}
    ]);
    expect((db.prepare("SELECT COUNT(DISTINCT book_id) count FROM verses WHERE translation_id='BSB'").get() as {count:number}).count).toBe(66);
    expect((db.prepare("SELECT text FROM verses WHERE translation_id='BSB' AND book_id='JHN' AND chapter=3 AND verse=16").get() as {text:string}).text).toContain('God so loved the world');
    db.close();
  });
  it('upgrades an existing single-translation content database without losing its WEB text', () => {
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'selah-content-'));
    const file=path.join(directory,'content.sqlite');
    const legacy=new Database(file);
    legacy.exec("CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE books(id TEXT PRIMARY KEY,name TEXT NOT NULL,testament TEXT NOT NULL,book_order INTEGER NOT NULL UNIQUE,chapters INTEGER NOT NULL); CREATE TABLE verses(book_id TEXT NOT NULL,chapter INTEGER NOT NULL,verse INTEGER NOT NULL,text TEXT NOT NULL,PRIMARY KEY(book_id,chapter,verse)); CREATE TABLE questions(id TEXT PRIMARY KEY,book_id TEXT NOT NULL,chapter INTEGER NOT NULL,verse_start INTEGER NOT NULL,verse_end INTEGER NOT NULL,question_text TEXT NOT NULL,answer_a TEXT NOT NULL,answer_b TEXT NOT NULL,answer_c TEXT NOT NULL,answer_d TEXT NOT NULL,correct_index INTEGER NOT NULL); CREATE TABLE animals(id TEXT PRIMARY KEY,name TEXT NOT NULL,emoji TEXT NOT NULL,unlock_level INTEGER NOT NULL,sort_order INTEGER NOT NULL); INSERT INTO metadata VALUES('question_bank_version','legacy'); INSERT INTO books VALUES('GEN','Genesis','OT',1,50); INSERT INTO verses VALUES('GEN',1,1,'Legacy WEB verse');");
    legacy.close();
    const upgraded=ensureContent(file);
    expect((upgraded.prepare("SELECT text FROM verses WHERE translation_id='WEB'").get() as {text:string}).text).toBe('Legacy WEB verse');
    expect((upgraded.prepare('SELECT COUNT(*) count FROM translations').get() as {count:number}).count).toBe(3);
    upgraded.close();
    fs.rmSync(directory,{recursive:true,force:true});
  });
  it('seeds the approved crossword clues bank with Genesis, Exodus, and Acts clues', () => {
    const db = ensureContent(':memory:');
    const totalCount = (db.prepare('SELECT COUNT(*) count FROM crossword_clues').get() as {count:number}).count;
    expect(totalCount).toBe(75);
    const genCount = (db.prepare("SELECT COUNT(*) count FROM crossword_clues WHERE book_id='GEN'").get() as {count:number}).count;
    expect(genCount).toBe(25);
    const exoCount = (db.prepare("SELECT COUNT(*) count FROM crossword_clues WHERE book_id='EXO'").get() as {count:number}).count;
    expect(exoCount).toBe(21);
    const actCount = (db.prepare("SELECT COUNT(*) count FROM crossword_clues WHERE book_id='ACT'").get() as {count:number}).count;
    expect(actCount).toBe(29);
    expect(db.prepare("SELECT answer,reference FROM crossword_clues WHERE id='CROSS-GEN-000001'").get()).toEqual({answer:'EDEN',reference:'Genesis 2:8'});
    expect(db.prepare("SELECT answer,reference FROM crossword_clues WHERE id='CROSS-EXO-000001'").get()).toEqual({answer:'MOSES',reference:'Exodus 2:10'});
    expect(db.prepare("SELECT answer,reference FROM crossword_clues WHERE id='CROSS-ACT-000001'").get()).toEqual({answer:'MATTHIAS',reference:'Acts 1:26'});
    db.close();
  });
});
