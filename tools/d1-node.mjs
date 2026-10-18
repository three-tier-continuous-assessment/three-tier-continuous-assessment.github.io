// A D1-compatible adapter over node:sqlite, for development and tests (brief §3.8).
// Implements the subset the handler uses: prepare().bind().first()/all()/run(), batch().

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

export function d1Node(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  const plain = (row) => (row ? { ...row } : null);

  class Statement {
    constructor(sql, params = []) {
      this.sql = sql;
      this.params = params;
    }
    bind(...params) {
      return new Statement(this.sql, params);
    }
    async first(column) {
      const row = plain(db.prepare(this.sql).get(...this.params));
      return column && row ? row[column] : row;
    }
    async all() {
      return { results: db.prepare(this.sql).all(...this.params).map(plain), success: true, meta: {} };
    }
    async run() {
      return this.runSync();
    }
    runSync() {
      const info = db.prepare(this.sql).run(...this.params);
      return { success: true, meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
    }
  }

  return {
    prepare: (sql) => new Statement(sql),
    async batch(statements) {
      db.exec('BEGIN');
      try {
        const out = statements.map((s) => s.runSync());
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    exec: (sql) => db.exec(sql),
    close: () => db.close(),
  };
}

/** Applies worker/migrations/*.sql in name order. */
export function migrate(d1, dir = new URL('../worker/migrations/', import.meta.url)) {
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
    d1.exec(readFileSync(new URL(f, dir), 'utf8'));
  }
}
