// Локальная замена D1 на node:sqlite (настоящий SQLite) — для тестов и dev-сервера. В прод-сборку не входит.
import { createRequire } from 'node:module';
import type { DatabaseSync as DB } from 'node:sqlite';
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
type DatabaseSync = DB;
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type P = unknown[];
const clean = (a: P) => a.map(v => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v));

class Stmt {
  args: P = [];
  constructor(private db: DatabaseSync, public sql: string, private counter: { n: number }) {}
  bind(...a: P) { const s = new Stmt(this.db, this.sql, this.counter); s.args = clean(a); return s; }
  private meta(r: { changes: number | bigint; lastInsertRowid: number | bigint }) { return { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) }; }
  async first<T>() { this.counter.n++; return (this.db.prepare(this.sql).get(...(this.args as any)) as T) ?? null; }
  async all<T>() { this.counter.n++; const results = this.db.prepare(this.sql).all(...(this.args as any)) as T[]; return { results, success: true, meta: { changes: 0 } }; }
  async run() {
    this.counter.n++;
    const st = this.db.prepare(this.sql);
    if (/\breturning\b/i.test(this.sql)) { st.all(...(this.args as any)); return { success: true, results: [], meta: { changes: 1 } }; }
    return { success: true, results: [], meta: this.meta(st.run(...(this.args as any))) };
  }
  _runInTx() {
    const st = this.db.prepare(this.sql);
    if (/^\s*select\b/i.test(this.sql) || /\breturning\b/i.test(this.sql)) {
      const results = st.all(...(this.args as any)); return { success: true, results, meta: { changes: 0 } };
    }
    return { success: true, results: [], meta: this.meta(st.run(...(this.args as any))) };
  }
}

export interface LocalD1 { db: D1Database; raw: DatabaseSync; stmtCount: () => number; resetCount: () => void }

export function createLocalD1(path = ':memory:', migrationsDir?: string): LocalD1 {
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  if (migrationsDir) {
    const tracked=raw.prepare("SELECT 1 FROM sqlite_master WHERE name='local_schema_migrations'").get();
    raw.exec('BEGIN');
    try {
      raw.exec('CREATE TABLE IF NOT EXISTS local_schema_migrations (name TEXT PRIMARY KEY)');
      // Databases made by the original adapter already contain these two migrations.
      if(!tracked)for(const [name,table] of [['0001_core.sql','accounts'],['0002_money.sql','categories']]){
        if(raw.prepare('SELECT 1 FROM sqlite_master WHERE name=?').get(table))raw.prepare('INSERT INTO local_schema_migrations (name) VALUES (?)').run(name);
      }
      for(const f of readdirSync(migrationsDir).filter(f=>f.endsWith('.sql')).sort()){
        if(raw.prepare('SELECT 1 FROM local_schema_migrations WHERE name=?').get(f))continue;
        raw.exec(readFileSync(join(migrationsDir,f),'utf8'));
        raw.prepare('INSERT INTO local_schema_migrations (name) VALUES (?)').run(f);
      }
      raw.exec('COMMIT');
    }catch(e){raw.exec('ROLLBACK');raw.close();throw e;}
  }
  const counter = { n: 0 };
  const db = {
    prepare: (sql: string) => new Stmt(raw, sql, counter),
    async batch(stmts: Stmt[]) {
      counter.n++;
      raw.exec('BEGIN');
      try { const out = stmts.map(s => s._runInTx()); raw.exec('COMMIT'); return out; }
      catch (e) { raw.exec('ROLLBACK'); throw e; }
    },
    async exec(sql: string) { raw.exec(sql); return { count: 1, duration: 0 }; },
  } as unknown as D1Database;
  return { db, raw, stmtCount: () => counter.n, resetCount: () => { counter.n = 0; } };
}
