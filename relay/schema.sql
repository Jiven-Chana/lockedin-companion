-- LockedIn relay (v0.1 F-112, spec §5): one row set per laptop-phone pair.
-- Tokens are stored as SHA-256 hashes, never in the clear.
CREATE TABLE IF NOT EXISTS pairs (
	id TEXT PRIMARY KEY,
	laptop_hash TEXT NOT NULL,
	phone_hash TEXT NOT NULL,
	created_at TEXT NOT NULL,
	phone_seen_at TEXT,
	time_zone TEXT,
	schedule_version INTEGER NOT NULL DEFAULT 0,
	blocks TEXT NOT NULL DEFAULT '[]',
	feed_token TEXT
);
CREATE TABLE IF NOT EXISTS subscriptions (
	pair_id TEXT NOT NULL,
	endpoint TEXT NOT NULL,
	created_at TEXT NOT NULL,
	PRIMARY KEY (pair_id, endpoint)
);
CREATE TABLE IF NOT EXISTS nudges (
	pair_id TEXT NOT NULL,
	id TEXT NOT NULL,
	fire_at TEXT NOT NULL,
	expires_at TEXT NOT NULL,
	payload TEXT NOT NULL,
	sent_at TEXT,
	PRIMARY KEY (pair_id, id)
);
CREATE INDEX IF NOT EXISTS nudges_due ON nudges (sent_at, fire_at);
CREATE TABLE IF NOT EXISTS events (
	seq INTEGER PRIMARY KEY AUTOINCREMENT,
	pair_id TEXT NOT NULL,
	id TEXT NOT NULL,
	at TEXT NOT NULL,
	type TEXT NOT NULL,
	payload TEXT NOT NULL,
	received_at TEXT NOT NULL,
	acked_at TEXT,
	UNIQUE (pair_id, id)
);
-- v1.0.3: pairing by a 6-digit code typed on the phone. A code names a pair for ten
-- minutes and is deleted when used. It holds no token: claiming it mints the phone a new one.
CREATE TABLE IF NOT EXISTS pair_codes (
	code TEXT PRIMARY KEY,
	pair_id TEXT NOT NULL,
	expires_at TEXT NOT NULL
);
-- Wrong codes typed in the last minute, across the relay (the limit on guessing). No address or device is kept.
CREATE TABLE IF NOT EXISTS claim_failures (
	at TEXT NOT NULL
);
