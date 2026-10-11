import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.ts';

mkdirSync(config.dataDir, { recursive: true });

export const db = new DatabaseSync(process.env.DB_PATH ?? path.join(config.dataDir, 'app.db'));

// All timestamps are epoch milliseconds (UTC). Mauritius time is applied at the edges.
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS outages (
    id             INTEGER PRIMARY KEY,
    utility        TEXT NOT NULL CHECK (utility IN ('electricity', 'water')),
    kind           TEXT NOT NULL,           -- planned | interruption | schedule | advisory | news | community
    source         TEXT NOT NULL,           -- ceb | cwa | community | admin
    source_ref     TEXT NOT NULL UNIQUE,    -- dedupe key per source
    title          TEXT NOT NULL,
    details        TEXT,
    area_label     TEXT,                    -- locality text exactly as published
    district       TEXT,
    scope          TEXT NOT NULL DEFAULT 'locality', -- locality | district | national
    starts_at      INTEGER NOT NULL,
    ends_at        INTEGER,
    visible_until  INTEGER NOT NULL,
    url            TEXT,
    attachment_url TEXT,
    confirmations  INTEGER NOT NULL DEFAULT 0,
    notify         INTEGER NOT NULL DEFAULT 1,
    notified_at    INTEGER,
    cancelled_at   INTEGER,
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS outages_visible ON outages (visible_until);

  CREATE TABLE IF NOT EXISTS outage_localities (
    outage_id INTEGER NOT NULL REFERENCES outages(id) ON DELETE CASCADE,
    locality  TEXT NOT NULL,
    PRIMARY KEY (outage_id, locality)
  );
  CREATE INDEX IF NOT EXISTS outage_localities_locality ON outage_localities (locality);

  CREATE TABLE IF NOT EXISTS subscribers (
    id                INTEGER PRIMARY KEY,
    channel           TEXT NOT NULL CHECK (channel IN ('webpush', 'whatsapp', 'sms')),
    address           TEXT NOT NULL,        -- E.164 phone, or push endpoint
    push_keys         TEXT,                 -- JSON {p256dh, auth} for web push
    lang              TEXT NOT NULL DEFAULT 'en',
    utilities         TEXT NOT NULL DEFAULT 'electricity,water',
    verified          INTEGER NOT NULL DEFAULT 0,
    otp_hash          TEXT,
    otp_expires       INTEGER,
    otp_attempts      INTEGER NOT NULL DEFAULT 0,
    unsubscribe_token TEXT NOT NULL UNIQUE,
    created_at        INTEGER NOT NULL,
    UNIQUE (channel, address)
  );

  CREATE TABLE IF NOT EXISTS subscriber_localities (
    subscriber_id INTEGER NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
    locality      TEXT NOT NULL,
    district      TEXT NOT NULL,
    PRIMARY KEY (subscriber_id, locality)
  );

  CREATE TABLE IF NOT EXISTS deliveries (
    outage_id     INTEGER NOT NULL REFERENCES outages(id) ON DELETE CASCADE,
    subscriber_id INTEGER NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
    status        TEXT NOT NULL,           -- sent | logged | failed
    error         TEXT,
    sent_at       INTEGER NOT NULL,
    PRIMARY KEY (outage_id, subscriber_id)
  );

  CREATE TABLE IF NOT EXISTS reports (
    id           INTEGER PRIMARY KEY,
    utility      TEXT NOT NULL CHECK (utility IN ('electricity', 'water')),
    locality     TEXT NOT NULL,
    description  TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
    reporter     TEXT NOT NULL,                   -- salted hash of IP, never the IP itself
    created_at   INTEGER NOT NULL,
    moderated_at INTEGER,
    outage_id    INTEGER REFERENCES outages(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS confirmations (
    outage_id INTEGER NOT NULL REFERENCES outages(id) ON DELETE CASCADE,
    reporter  TEXT NOT NULL,
    PRIMARY KEY (outage_id, reporter)
  );

  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ingest_runs (
    id          INTEGER PRIMARY KEY,
    source      TEXT NOT NULL,
    started_at  INTEGER NOT NULL,
    finished_at INTEGER,
    found       INTEGER,
    created     INTEGER,
    error       TEXT
  );
`);

// Columns added after the first release. SQLite has no ADD COLUMN IF NOT EXISTS.
const outageColumns = new Set((db.prepare('PRAGMA table_info(outages)').all() as Array<{ name: string }>).map((c) => c.name));
for (const [name, type] of [['image_source', 'TEXT'], ['image_url', 'TEXT'], ['image_checked_at', 'INTEGER']]) {
  if (!outageColumns.has(name)) db.exec(`ALTER TABLE outages ADD COLUMN ${name} ${type}`);
}

export function getMeta(key: string): string | null {
  return (db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null;
}

export function setMeta(key: string, value: string) {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value);
}

let depth = 0;

/** Run fn atomically. Nested calls join the outer transaction. */
export function transaction<T>(fn: () => T): T {
  if (depth > 0) return fn();
  db.exec('BEGIN');
  depth++;
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    depth--;
  }
}
