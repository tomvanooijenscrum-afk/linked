-- 001: gebruikers met rollen, evenementen en NFC-polsbanden.
--
-- Op de tag staat alleen een link met een willekeurig token. Hier staat
-- alleen de SHA-256-hash van dat token, nooit het token zelf, en geen
-- persoonsgegevens van de drager.

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE
    CHECK (length(username) BETWEEN 3 AND 40),
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'volunteer')),
  created_at TEXT NOT NULL
);

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
    CHECK (length(name) BETWEEN 1 AND 80),
  created_at TEXT NOT NULL
);

CREATE TABLE wristbands (
  -- Interne ID (UUID) en leesbaar nummer (WB-0001).
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  number INTEGER NOT NULL UNIQUE CHECK (number > 0),
  -- 7-byte NTAG213-UID als 14 hoofdletter-hextekens.
  tag_uid TEXT NOT NULL UNIQUE
    CHECK (length(tag_uid) = 14 AND tag_uid NOT GLOB '*[^0-9A-F]*'),
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  event_id INTEGER REFERENCES events (id) ON DELETE RESTRICT,
  -- reserved: token uitgegeven, nog niet bevestigd
  -- failed:   schrijven of controleren mislukt, opnieuw proberen kan
  -- verified: link teruggelezen en door de beheerder bevestigd
  write_status TEXT NOT NULL DEFAULT 'reserved'
    CHECK (write_status IN ('reserved', 'failed', 'verified')),
  is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
  write_attempts INTEGER NOT NULL DEFAULT 1 CHECK (write_attempts > 0),
  last_error TEXT,
  registered_by INTEGER NOT NULL REFERENCES users (id),
  registered_at TEXT NOT NULL,
  verified_at TEXT,
  activated_at TEXT,
  deactivated_at TEXT,
  updated_at TEXT NOT NULL,
  -- Alleen een gecontroleerd bandje kan actief zijn.
  CHECK (is_active = 0 OR write_status = 'verified')
);

CREATE INDEX wristbands_event_id ON wristbands (event_id);
CREATE INDEX wristbands_status ON wristbands (write_status, is_active);
