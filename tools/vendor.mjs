#!/usr/bin/env node
// Copies the browser libraries from node_modules into web/vendor/, with a manifest of versions.
// The legacy pdf.js build is used because lecturers upload from older phone browsers too.
//   node tools/vendor.mjs

import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const nm = new URL('../node_modules/', import.meta.url);
const out = new URL('../web/vendor/', import.meta.url);
const version = (pkg) => JSON.parse(readFileSync(new URL(`${pkg}/package.json`, nm), 'utf8')).version;

rmSync(out, { recursive: true, force: true });
const copy = (from, to) => {
  mkdirSync(new URL('.', new URL(to, out)), { recursive: true });
  cpSync(new URL(from, nm), new URL(to, out));
};

copy('pdfjs-dist/legacy/build/pdf.min.mjs', 'pdfjs/pdf.min.mjs');
copy('pdfjs-dist/legacy/build/pdf.worker.min.mjs', 'pdfjs/pdf.worker.min.mjs');
copy('pdfjs-dist/LICENSE', 'pdfjs/LICENSE');
copy('mammoth/mammoth.browser.min.js', 'mammoth/mammoth.browser.min.js');
copy('mammoth/LICENSE', 'mammoth/LICENSE');
copy('katex/dist/katex.mjs', 'katex/katex.mjs');
copy('katex/dist/contrib/mhchem.mjs', 'katex/contrib/mhchem.mjs');
copy('katex/dist/katex.min.css', 'katex/katex.min.css');
copy('katex/LICENSE', 'katex/LICENSE');
for (const f of readdirSync(new URL('katex/dist/fonts/', nm)).filter((f) => f.endsWith('.woff2'))) copy(`katex/dist/fonts/${f}`, `katex/fonts/${f}`);
copy('sql.js/dist/sql-wasm.js', 'sqljs/sql-wasm.js');
copy('sql.js/dist/sql-wasm.wasm', 'sqljs/sql-wasm.wasm');
copy('sql.js/LICENSE', 'sqljs/LICENSE');

const manifest = Object.fromEntries(['pdfjs-dist', 'mammoth', 'katex', 'sql.js'].map((p) => [p, version(p)]));
writeFileSync(new URL('VERSIONS.json', out), JSON.stringify(manifest, null, 2) + '\n');
console.log('vendored', manifest);
