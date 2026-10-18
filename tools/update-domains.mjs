#!/usr/bin/env node
// Regenerates worker/data/university-domains.json from the open university-domains list
// (Hipo, MIT licence), pinned to a commit so that rebuilds are reproducible.
//   node tools/update-domains.mjs            -> latest commit on master
//   node tools/update-domains.mjs <sha>      -> that commit

import { writeFileSync } from 'node:fs';

const REPO = 'Hipo/university-domains-list';
const sha = process.argv[2] ?? (await (await fetch(`https://api.github.com/repos/${REPO}/commits/master`)).json()).sha;
if (!/^[0-9a-f]{40}$/.test(sha ?? '')) throw new Error('could not resolve the commit');
const url = `https://raw.githubusercontent.com/${REPO}/${sha}/world_universities_and_domains.json`;
const list = await (await fetch(url)).json();
const domains = [...new Set(list.flatMap((u) => u.domains ?? []).map((d) => String(d).trim().toLowerCase()).filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)))].sort();
const out = {
  source: `https://github.com/${REPO}`,
  licence: 'MIT',
  commit: sha,
  institutions: list.length,
  domains,
};
writeFileSync(new URL('../worker/data/university-domains.json', import.meta.url), JSON.stringify(out) + '\n');
console.log(`${list.length} institutions, ${domains.length} domains, commit ${sha}`);
