-- Three-Tier Continuous Assessment: initial schema (D1 / SQLite).
-- Times are milliseconds since the epoch (UTC). JSON columns hold TEXT.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  google_sub TEXT UNIQUE,
  email TEXT,
  name TEXT,
  hd TEXT,
  created_at INTEGER NOT NULL,
  suspended INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE verifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  level INTEGER NOT NULL CHECK (level IN (1, 2, 3)),
  method TEXT NOT NULL,              -- google-hd | orcid | scholar | scopus | nin
  identifier TEXT,                   -- email, ORCID iD, Scholar user id, Scopus id; never a NIN
  status TEXT NOT NULL,              -- issued | review | passed | failed | revoked
  code_hash TEXT,                    -- Level 2 challenge code, hashed
  code_expires_at INTEGER,
  provider_ref TEXT,                 -- Level 3 provider reference
  nin_hmac TEXT UNIQUE,              -- HMAC-SHA256(NIN_PEPPER, NIN); one NIN, one account
  reviewer TEXT,
  note TEXT,
  checked_at INTEGER,
  expires_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX verifications_user ON verifications(user_id, level, status);

CREATE TABLE courses (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  institution TEXT,
  code TEXT,
  title TEXT NOT NULL,
  level TEXT,
  tier TEXT NOT NULL CHECK (tier IN ('primary', 'secondary', 'tertiary')),
  co_lecturers TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);
CREATE INDEX courses_owner ON courses(owner_id);

CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,                -- pdf | photo | docx | tex | md | txt
  first_page INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE note_pages (
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  printed INTEGER,
  text TEXT NOT NULL,
  hash TEXT NOT NULL,
  transcribed INTEGER NOT NULL DEFAULT 0,
  confirmed INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (note_id, idx)
);

CREATE TABLE questions (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  body TEXT NOT NULL,                -- JSON: type, stem, options, key, tolerance, accepted, explanation, difficulty, marks, fixed_options
  source TEXT NOT NULL,              -- JSON: {note, page, quote, page_hash, quiz} or {import}
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'retired')),
  disputed INTEGER NOT NULL DEFAULT 0,
  source_changed INTEGER NOT NULL DEFAULT 0,
  ai_key INTEGER NOT NULL DEFAULT 0, -- the key was proposed by the model and awaits confirmation
  licence TEXT NOT NULL DEFAULT 'all-rights-reserved',
  created_at INTEGER NOT NULL,
  modified_at INTEGER NOT NULL
);
CREATE INDEX questions_course ON questions(course_id, status);

CREATE TABLE question_versions (
  question_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  body TEXT NOT NULL,
  at INTEGER NOT NULL,
  by TEXT,
  PRIMARY KEY (question_id, version)
);

CREATE TABLE quizzes (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  code TEXT UNIQUE,                  -- the public code in links
  title TEXT NOT NULL,
  label TEXT,
  selection TEXT,                    -- JSON notes selection, or null
  question_ids TEXT NOT NULL DEFAULT '[]',
  duration INTEGER NOT NULL,
  pace INTEGER NOT NULL,
  count INTEGER NOT NULL,
  grace INTEGER NOT NULL DEFAULT 3,
  opens_at INTEGER,
  last_start INTEGER,
  open_sitting INTEGER NOT NULL DEFAULT 0,
  scale_to REAL,
  bands TEXT NOT NULL DEFAULT 'none',
  pass_mark REAL NOT NULL DEFAULT 40,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'closed')),
  secret TEXT,                       -- hex sitting key K; never leaves the server
  capacity INTEGER,
  roster_size INTEGER NOT NULL DEFAULT 0,
  next_spare INTEGER,
  gold INTEGER NOT NULL DEFAULT 0,   -- set by a Gold Certified owner at publication
  created_at INTEGER NOT NULL,
  published_at INTEGER
);
CREATE INDEX quizzes_course ON quizzes(course_id);

CREATE TABLE quiz_questions (
  quiz_id TEXT NOT NULL REFERENCES quizzes(id),
  question_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  body TEXT NOT NULL,                -- snapshot at publication
  PRIMARY KEY (quiz_id, question_id)
);

CREATE TABLE roster (
  quiz_id TEXT NOT NULL REFERENCES quizzes(id),
  seat INTEGER NOT NULL,
  reg_no TEXT NOT NULL,
  full_name TEXT,
  email TEXT,
  phone TEXT,
  code_hash TEXT,
  listed INTEGER NOT NULL DEFAULT 1,
  confirmed INTEGER NOT NULL DEFAULT 1,
  bound_sub TEXT,
  PRIMARY KEY (quiz_id, seat),
  UNIQUE (quiz_id, reg_no)
);
CREATE INDEX roster_code ON roster(quiz_id, code_hash);
CREATE UNIQUE INDEX roster_sub ON roster(quiz_id, bound_sub) WHERE bound_sub IS NOT NULL;

CREATE TABLE attempts (
  id TEXT PRIMARY KEY,
  quiz_id TEXT NOT NULL REFERENCES quizzes(id),
  seat INTEGER NOT NULL,
  candidate TEXT NOT NULL,           -- JSON: name, reg_no, email, phone, self_declared, listed
  question_order TEXT NOT NULL,      -- JSON array of question ids
  session_nonce TEXT,
  t0 INTEGER,
  status TEXT NOT NULL DEFAULT 'checked-in' CHECK (status IN ('checked-in', 'started', 'finished', 'void')),
  result TEXT,
  score REAL,
  max REAL,
  percent REAL,
  result_id TEXT UNIQUE,
  finished_at INTEGER,
  void_reason TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (quiz_id, seat)
);

CREATE TABLE answers (
  attempt_id TEXT NOT NULL REFERENCES attempts(id),
  slot INTEGER NOT NULL,
  choice TEXT,
  received_at INTEGER NOT NULL,
  PRIMARY KEY (attempt_id, slot)
);

CREATE TABLE payments (
  reference TEXT PRIMARY KEY,
  product TEXT NOT NULL,
  targets TEXT NOT NULL,             -- JSON array of entitlement targets
  amount_kobo INTEGER NOT NULL,
  currency TEXT NOT NULL,
  payer_email TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  verified_at INTEGER
);
CREATE INDEX payments_status ON payments(status, created_at);

CREATE TABLE payment_targets (
  reference TEXT NOT NULL REFERENCES payments(reference),
  product TEXT NOT NULL,
  target TEXT NOT NULL,
  PRIMARY KEY (reference, product, target)
);
CREATE INDEX payment_targets_target ON payment_targets(product, target);

CREATE TABLE entitlements (
  product TEXT NOT NULL,
  target TEXT NOT NULL,
  reference TEXT NOT NULL,
  granted_at INTEGER NOT NULL,
  PRIMARY KEY (product, target)
);

CREATE TABLE ai_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  purpose TEXT NOT NULL,
  model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd REAL,
  at INTEGER NOT NULL
);
CREATE INDEX ai_usage_user ON ai_usage(user_id, at);

CREATE TABLE rate_limits (
  key TEXT NOT NULL,
  window INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (key, window)
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  actor TEXT,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT
);
