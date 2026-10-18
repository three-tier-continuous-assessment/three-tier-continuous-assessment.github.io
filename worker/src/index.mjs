// Cloudflare Workers entry (production). Real services only: Google ID tokens, Paystack (test or
// live keys, as configured), Claude when ANTHROPIC_API_KEY is set. The fakes used in development
// and in the browser demo are refused here.

import { createApp } from './app.mjs';
import pricing from '../../config/pricing.json';
import tiers from '../../config/tiers.json';
import domainData from '../data/university-domains.json';
import { googleVerifier } from './services/google.mjs';
import { paystackClient } from './services/paystack.mjs';
import { claudeAI, fakeAI } from './services/ai.mjs';
import { unconfiguredNinProvider } from './services/nin.mjs';
import { json } from './util.mjs';

const list = (s) => String(s ?? '').split(/[,\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);

function unconfiguredPaystack() {
  const off = async () => {
    const e = new Error('payments are not configured yet');
    e.status = 503;
    throw e;
  };
  return { fake: false, initialize: off, verify: off, list: off, verifySignature: async () => false };
}

let built = null;

async function build(env) {
  for (const k of ['SESSION_KEY', 'NIN_PEPPER', 'SITE_ORIGIN', 'GOOGLE_CLIENT_ID']) {
    if (!env[k]) throw new Error(`missing configuration: ${k}`);
  }
  const domains = new Set(domainData.domains);
  let ai = fakeAI();
  let aiReal = false;
  if (env.ANTHROPIC_API_KEY) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    ai = claudeAI(new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }), env.AI_MODEL ? { model: env.AI_MODEL } : {});
    aiReal = true;
  }
  const app = createApp({
    db: env.DB,
    config: {
      pricing,
      tiers,
      isListedDomain: (d) => domains.has(d),
      extraDomains: list(env.EXTRA_DOMAINS),
      blockedDomains: list(env.BLOCKED_DOMAINS),
      studentPatterns: env.STUDENT_PATTERNS ? JSON.parse(env.STUDENT_PATTERNS) : {},
    },
    services: {
      google: googleVerifier({ clientId: env.GOOGLE_CLIENT_ID }),
      paystack: env.PAYSTACK_SECRET_KEY ? paystackClient({ secretKey: env.PAYSTACK_SECRET_KEY }) : unconfiguredPaystack(),
      ai: aiReal ? ai : { ...ai, name: 'unconfigured', generate: offAI, resolve: offAI, transcribe: offAI, assist: offAI },
      nin: unconfiguredNinProvider(),
    },
    secrets: { SESSION_KEY: env.SESSION_KEY, NIN_PEPPER: env.NIN_PEPPER, SITE_ORIGIN: env.SITE_ORIGIN, ADMIN_EMAILS: env.ADMIN_EMAILS },
  });
  return app;
}

async function offAI() {
  const e = new Error('AI features are not configured yet: the Question Pool works without them');
  e.status = 503;
  throw e;
}

export default {
  async fetch(request, env) {
    try {
      built ??= build(env);
      const app = await built;
      return app(request, { ip: request.headers.get('cf-connecting-ip') ?? 'unknown' });
    } catch (e) {
      built = null;
      console.error('startup failed', e?.message);
      return json({ error: 'the service is not configured correctly' }, 500);
    }
  },
};
