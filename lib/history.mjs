import { randomUUID, createHash } from 'node:crypto';
import { mkdir, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { HttpError, cleanText, webUrl } from './util.mjs';
import { filmTitle, filmYear, filmFamily, sameFilm } from '../public/history-utils.js';

export function supportedHistoryNode(version=process.versions.node) {
  const [major,minor]=version.split('.').map(Number);return major>22||major===22&&minor>=18;
}
export async function sqliteRuntime() {
  if(!supportedHistoryNode())throw new Error('需要 Node.js 22.18 或更新版本及内置 SQLite，请手动安装兼容 Node.js：https://nodejs.org/');
  try { const sqlite=await import('node:sqlite');if(typeof sqlite.DatabaseSync!=='function')throw new Error();return sqlite; }
  catch {throw new Error('当前 Node.js 缺少内置 SQLite。请手动安装完整版 Node.js 22.18 或更新版本；无需单独安装 sqlite3。');}
}
export async function openHistory(root,{checkOnly=false,path}={}) {
  const {DatabaseSync,backup}=await sqliteRuntime();
  const filename=path||join(root,'data','history.sqlite');
  if(checkOnly) {
    try{await access(filename);}catch(e){if(e.code==='ENOENT')return null;throw e;}
  }else await mkdir(join(root,'data'),{recursive:true});
  let db;
  try {
    db=new DatabaseSync(filename,{readOnly:checkOnly,timeout:2000});
    const integrity=db.prepare('PRAGMA quick_check').get();
    if(Object.values(integrity)[0]!=='ok')throw new Error('完整性检查失败');
    const version=db.prepare('PRAGMA user_version').get().user_version;
    if(version>1)throw new Error('数据库版本比当前程序更新，请使用新版 My TV');
    if(checkOnly){if(version!==1)throw new Error('历史数据库需要迁移，请运行启动脚本');db.close();return {checked:true};}
    if(version<1) {
      const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
      const expected={films:['id','kind','identity','meta','last_played','last_episode','owner','owner_time'],episodes:['film_id','episode_key','name','position','duration','completed','locator','updated'],bindings:['binding_key','film_id']};
      for(const [table,columns] of Object.entries(expected))if(tables.some(t=>t.name===table)){
        const actual=db.prepare('PRAGMA table_info('+table+')').all().map(c=>c.name);
        if(columns.some(c=>!actual.includes(c)))throw new Error('旧历史表结构不兼容，请保留文件并使用对应版本迁移');
      }
      if(tables.length)await backup(db,filename+'.backup-'+Date.now());
      db.exec('BEGIN IMMEDIATE');
      try{db.exec(`
        CREATE TABLE IF NOT EXISTS films(id TEXT PRIMARY KEY,kind TEXT NOT NULL,identity TEXT NOT NULL,meta TEXT NOT NULL,last_played INTEGER NOT NULL,last_episode TEXT NOT NULL,owner TEXT,owner_time INTEGER NOT NULL DEFAULT 0);
        CREATE INDEX IF NOT EXISTS film_identity ON films(identity);
        CREATE TABLE IF NOT EXISTS episodes(film_id TEXT NOT NULL REFERENCES films(id) ON DELETE CASCADE,episode_key TEXT NOT NULL,name TEXT NOT NULL,position REAL NOT NULL,duration REAL NOT NULL,completed INTEGER NOT NULL,locator TEXT NOT NULL,updated INTEGER NOT NULL,PRIMARY KEY(film_id,episode_key));
        CREATE TABLE IF NOT EXISTS bindings(binding_key TEXT PRIMARY KEY,film_id TEXT NOT NULL REFERENCES films(id) ON DELETE CASCADE);
        PRAGMA user_version=1; COMMIT;`);}catch(e){db.exec('ROLLBACK');throw e;}
    }
    db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
    // Exercise a write transaction, including an already-created but read-only data directory.
    await access(join(root,'data'),constants.W_OK);
    db.exec('BEGIN IMMEDIATE; UPDATE films SET last_played=last_played WHERE 0; COMMIT;');
    return new HistoryStore(db);
  }catch(e){try{db?.close();}catch{}throw new Error('历史数据库无法初始化：'+e.message+'。请检查 data 目录权限、磁盘空间或数据库备份；原文件不会被清空。');}
}
const digest=s=>createHash('sha256').update(s).digest('hex');
const text=(v,n=200)=>cleanText(v).slice(0,n);
export class HistoryStore {
  constructor(db){this.db=db;this.sessions=new Map();this.claimClock=Math.max(Date.now(),db.prepare('SELECT coalesce(max(owner_time),0) AS n FROM films').get().n);}
  claimTime(){return this.claimClock=Math.max(Date.now(),this.claimClock+1);}
  metadata(raw){return {title:text(raw.title)||'链接播放',poster:text(raw.poster,3000),year:text(raw.year,40),type:text(raw.type,80),area:text(raw.area,80)};}
  identity(meta,locator){return locator.direct?'direct:'+digest(webUrl(locator.url).href):
    filmYear(meta.year)&&filmFamily(meta.type)?[filmTitle(meta.title),filmYear(meta.year),filmFamily(meta.type)].join('|'):'unverified:'+this.binding(locator);}
  binding(l){return l.direct?'url:'+digest(webUrl(l.url).href):digest([webUrl(l.configUrl).href,text(l.sourceKey),String(l.videoId)].join('\n'));}
  find(meta,locator,chosen) {
    const bound=this.db.prepare('SELECT film_id FROM bindings WHERE binding_key=?').get(this.binding(locator));
    const records=this.db.prepare('SELECT * FROM films').all();
    const candidates=records.filter(r=>r.kind===(locator.direct?'direct':'vod')&&(locator.direct?r.identity===this.identity(meta,locator):filmTitle(JSON.parse(r.meta).title)===filmTitle(meta.title)));
    const compatible=r=>{const m=JSON.parse(r.meta);return (!filmYear(meta.year)||!filmYear(m.year)||filmYear(meta.year)===filmYear(m.year))&&(!filmFamily(meta.type)||!filmFamily(m.type)||filmFamily(meta.type)===filmFamily(m.type));};
    if(chosen){const row=records.find(r=>r.id===chosen);if(!row||!candidates.includes(row)||!compatible(row))throw new HttpError(400,'选择的历史记录与当前影片不匹配。');return {film:row};}
    if(bound){const row=records.find(r=>r.id===bound.film_id);if(row&&candidates.includes(row)&&compatible(row))return {film:row};}
    const exact=candidates.filter(r=>locator.direct||sameFilm(meta,JSON.parse(r.meta)));
    if(exact.length===1)return {film:exact[0]};
    const ambiguous=candidates.filter(r=>{const m=JSON.parse(r.meta);return (!filmYear(meta.year)||!filmYear(m.year)||filmYear(meta.year)===filmYear(m.year))&&(!filmFamily(meta.type)||!filmFamily(m.type)||filmFamily(meta.type)===filmFamily(m.type));});
    return {candidates:ambiguous.map(r=>this.record(r))};
  }
  prepare(meta,locator,episodeKey,chosen,distinct=false){
    const found=distinct?{}:this.find(meta,locator,chosen);
    return {filmId:found.film?.id||null,record:found.film?this.record(found.film):null,candidates:found.candidates||[],bookmark:found.film?this.episode(found.film.id,episodeKey):null};
  }
  episode(id,key){const r=this.db.prepare('SELECT * FROM episodes WHERE film_id=? AND episode_key=?').get(id,key);return r?{key:r.episode_key,name:r.name,position:r.position,duration:r.duration,completed:!!r.completed,locator:JSON.parse(r.locator)}:null;}
  record(row){return {id:row.id,kind:row.kind,...JSON.parse(row.meta),lastPlayed:row.last_played,episode:this.episode(row.id,row.last_episode)};}
  list(){return this.db.prepare('SELECT * FROM films ORDER BY last_played DESC,rowid DESC LIMIT 100').all().map(r=>this.record(r));}
  get(id){const r=this.db.prepare('SELECT * FROM films WHERE id=?').get(id);if(!r)throw new HttpError(404,'这条历史已删除或被淘汰。');return this.record(r);}
  start({meta,locator,episodeKey,episodeName,filmId,distinct,position,duration,claimedAt=this.claimTime()}) {
    this.validProgress(position,duration);
    const found=distinct?{}:this.find(meta,locator,filmId);
    if(found.candidates?.length)throw new HttpError(409,'存在同名历史，请先选择是否沿用进度。');
    const id=found.film?.id||randomUUID(),session=randomUUID(),now=claimedAt;
    if(found.film&&found.film.owner_time>claimedAt)return {session:null,filmId:id,superseded:true};
    if(found.film){const previous=JSON.parse(found.film.meta);meta={...previous,...Object.fromEntries(Object.entries(meta).filter(([,v])=>v))};}
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO films VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET meta=excluded.meta,last_played=excluded.last_played,last_episode=excluded.last_episode,owner=excluded.owner,owner_time=excluded.owner_time')
        .run(id,locator.direct?'direct':'vod',this.identity(meta,locator),JSON.stringify(meta),now,episodeKey,session,claimedAt);
      this.db.prepare('INSERT INTO bindings VALUES(?,?) ON CONFLICT(binding_key) DO UPDATE SET film_id=excluded.film_id').run(this.binding(locator),id);
      this.write(id,episodeKey,episodeName,position,duration,false,locator);
      this.db.exec('DELETE FROM films WHERE id NOT IN(SELECT id FROM films ORDER BY last_played DESC,rowid DESC LIMIT 100); COMMIT;');
    }catch(e){this.db.exec('ROLLBACK');throw e;}
    this.sessions.set(session,{filmId:id,episodeKey,episodeName,locator,seq:0});
    for(const [key,s] of this.sessions)if(!this.db.prepare('SELECT 1 FROM films WHERE id=?').get(s.filmId))this.sessions.delete(key);
    while(this.sessions.size>500)this.sessions.delete(this.sessions.keys().next().value);
    return {session,filmId:id,record:this.get(id)};
  }
  validProgress(position,duration){if(!Number.isFinite(position)||!Number.isFinite(duration)||duration<=0||position<0||position>duration+.5||duration>7*86400)throw new HttpError(400,'播放进度或时长无效。');}
  write(id,key,name,position,duration,completed,locator){this.db.prepare('INSERT INTO episodes VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(film_id,episode_key) DO UPDATE SET name=excluded.name,position=excluded.position,duration=excluded.duration,completed=excluded.completed,locator=excluded.locator,updated=excluded.updated')
    .run(id,key,text(name),position,duration,Number(completed),JSON.stringify(locator),Date.now());}
  update({session,seq,position,duration,completed=false}) {
    if(typeof completed!=='boolean')throw new HttpError(400,'播放结束状态无效。');
    this.validProgress(position,duration);const s=this.sessions.get(session);
    if(!s||!Number.isSafeInteger(seq)||seq<=s.seq)return {accepted:false};
    const film=this.db.prepare('SELECT owner FROM films WHERE id=?').get(s.filmId);
    if(!film||film.owner!==session)return {accepted:false};
    s.seq=seq;this.write(s.filmId,s.episodeKey,s.episodeName,position,duration,completed,s.locator);return {accepted:true};
  }
  delete(id){this.get(id);this.db.prepare('DELETE FROM films WHERE id=?').run(id);for(const[k,s]of this.sessions)if(s.filmId===id)this.sessions.delete(k);}
  close(){this.sessions.clear();if(this.db.isOpen)this.db.close();}
}
