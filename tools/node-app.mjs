// Builds the handler for Node (development server and tests): node:sqlite plus fakes, unless
// real services are passed in. Never used in production.

import { readFileSync } from 'node:fs';
import { d1Node, migrate } from './d1-node.mjs';
import { createApp } from '../worker/src/app.mjs';
import { fakeGoogleVerifier } from '../worker/src/services/google.mjs';
import { fakePaystack } from '../worker/src/services/paystack.mjs';
import { fakeAI } from '../worker/src/services/ai.mjs';
import { fakeNinProvider } from '../worker/src/services/nin.mjs';

const readJSON = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));

export function loadConfig() {
  const domains = new Set(readJSON('../worker/data/university-domains.json').domains);
  return {
    pricing: readJSON('../config/pricing.json'),
    tiers: readJSON('../config/tiers.json'),
    isListedDomain: (d) => domains.has(d),
    extraDomains: [],
    blockedDomains: [],
    studentPatterns: {},
  };
}

export function nodeApp(options = {}) {
  const db = d1Node(options.dbPath ?? ':memory:');
  migrate(db);
  const siteOrigin = options.siteOrigin ?? 'http://localhost:8790/';
  const services = {
    google: options.google ?? fakeGoogleVerifier(),
    paystack: options.paystack ?? fakePaystack({ siteOrigin }),
    ai: options.ai ?? fakeAI(),
    nin: options.nin ?? fakeNinProvider(options.ninRecords ?? {}),
    clock: options.clock,
  };
  const secrets = {
    SESSION_KEY: 'development-session-key-not-for-production',
    NIN_PEPPER: 'development-nin-pepper-not-for-production',
    SITE_ORIGIN: siteOrigin,
    ADMIN_EMAILS: options.adminEmails ?? 'admin@unn.edu.ng',
    ...options.secrets,
  };
  const config = { ...loadConfig(), ...options.config };
  return { app: createApp({ db, config, services, secrets }), db, services, config, secrets };
}
