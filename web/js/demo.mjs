// The demo server (brief §3.8): the real request handler, running in this page on sql.js
// (SQLite compiled to WebAssembly) with fake Google, Paystack, model and NIN services.
// Nothing reaches a server; the database is kept in this browser's IndexedDB.

import { useLocalServer, siteUrl, KEY } from './api.mjs';
import { createApp } from '../worker/src/app.mjs';
import { fakeGoogleVerifier } from '../worker/src/services/google.mjs';
import { fakePaystack } from '../worker/src/services/paystack.mjs';
import { fakeAI } from '../worker/src/services/ai.mjs';
import { fakeNinProvider } from '../worker/src/services/nin.mjs';
import { sha256Hex, toHex } from '../shared/sha256.mjs';

export const DEMO_ADMIN = 'admin@example.edu';
export const DEMO_NIN = { nin: '12345678901', record: { firstName: 'Ada', middleName: 'Ngozi', lastName: 'Obi', dob: '1980-01-31' } };
const DB_KEY = 'database';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`could not load ${src}`));
    document.head.append(s);
  });
}

function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('ttca-demo', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function idbGet(key) {
  const db = await idb();
  return new Promise((resolve) => {
    const q = db.transaction('kv').objectStore('kv').get(key);
    q.onsuccess = () => resolve(q.result ?? null);
    q.onerror = () => resolve(null);
  });
}
async function idbSet(key, value) {
  const db = await idb();
  return new Promise((resolve) => {
    const t = db.transaction('kv', 'readwrite');
    t.objectStore('kv').put(value, key);
    t.oncomplete = resolve;
    t.onerror = resolve;
  });
}

const WRITE = /^\s*(insert|update|delete|replace)\b/i;

/** A D1-compatible adapter over a sql.js database. */
function d1(db, onWrite) {
  class Statement {
    constructor(sql, params = []) {
      this.sql = sql;
      this.params = params;
    }
    bind(...params) {
      return new Statement(this.sql, params);
    }
    rows() {
      const st = db.prepare(this.sql);
      try {
        st.bind(this.params);
        const out = [];
        while (st.step()) out.push(st.getAsObject());
        if (WRITE.test(this.sql)) onWrite();
        return out;
      } finally {
        st.free();
      }
    }
    async first(column) {
      const row = this.rows()[0] ?? null;
      return column && row ? row[column] : row;
    }
    async all() {
      return { results: this.rows(), success: true, meta: {} };
    }
    runSync() {
      db.run(this.sql, this.params);
      onWrite();
      return { success: true, meta: { changes: db.getRowsModified() } };
    }
    async run() {
      return this.runSync();
    }
  }
  return {
    prepare: (sql) => new Statement(sql),
    async batch(statements) {
      db.run('BEGIN');
      try {
        const out = statements.map((s) => s.runSync());
        db.run('COMMIT');
        return out;
      } catch (e) {
        db.run('ROLLBACK');
        throw e;
      }
    },
  };
}

const randomKey = () => toHex(crypto.getRandomValues(new Uint8Array(32)));

export async function startDemo() {
  const asset = (p) => new URL(p, import.meta.url).href;
  await loadScript(asset('../vendor/sqljs/sql-wasm.js'));
  const SQL = await window.initSqlJs({ locateFile: (f) => asset(`../vendor/sqljs/${f}`) });
  const [migration, pricing, tiers, domains] = await Promise.all([
    fetch(asset('../worker/migrations/0001_init.sql')).then((r) => r.text()),
    fetch(asset('../config/pricing.json')).then((r) => r.json()),
    fetch(asset('../config/tiers.json')).then((r) => r.json()),
    fetch(asset('../worker/data/university-domains.json')).then((r) => r.json()),
  ]);

  // A schema change resets the demo database rather than running it on an old shape.
  const schema = sha256Hex(migration);
  const saved = localStorage.getItem('ttca.demo.schema') === schema ? await idbGet(DB_KEY) : null;
  const db = saved ? new SQL.Database(saved) : new SQL.Database();
  if (!saved) {
    db.exec(migration);
    localStorage.setItem('ttca.demo.schema', schema);
  }
  db.exec('PRAGMA foreign_keys = ON');

  let timer = null;
  const persist = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      idbSet(DB_KEY, db.export());
      db.exec('PRAGMA foreign_keys = ON'); // export() reopens the database
    }, 300);
  };
  window.addEventListener('pagehide', () => { clearTimeout(timer); idbSet(DB_KEY, db.export()); });

  const secret = (k) => {
    let v = localStorage.getItem(`ttca.demo.${k}`);
    if (!v) { v = randomKey(); localStorage.setItem(`ttca.demo.${k}`, v); }
    return v;
  };
  const site = `${location.origin}${location.pathname}`;
  const listed = new Set(domains.domains);
  const app = createApp({
    db: d1(db, persist),
    config: { pricing, tiers, isListedDomain: (d) => listed.has(d), extraDomains: ['example.edu'], blockedDomains: [], studentPatterns: {} },
    services: {
      google: fakeGoogleVerifier(),
      paystack: fakePaystack({ siteOrigin: siteUrl() }),
      ai: fakeAI(),
      nin: fakeNinProvider({ [DEMO_NIN.nin]: DEMO_NIN.record }),
    },
    secrets: { SESSION_KEY: secret('session'), NIN_PEPPER: secret('pepper'), SITE_ORIGIN: site, ADMIN_EMAILS: DEMO_ADMIN },
  });
  useLocalServer((request) => app(request, { ip: 'demo' }));
}

/** Clears the demo database and this browser's demo sessions. */
export async function resetDemo() {
  await idbSet(DB_KEY, null);
  for (const k of Object.keys(localStorage)) if (k.startsWith(KEY)) localStorage.removeItem(k);
}
