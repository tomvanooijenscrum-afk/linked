-- 002 (Postgres): hulpaanvragen, gedeeld tussen alle apparaten.
--
-- De aanvrager krijgt bij het aanmaken een geheim; hier staat alleen de
-- SHA-256-hash. Locaties zijn hypothetisch (demo), nooit echte posities.

CREATE TABLE help_requests (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  secret_hash TEXT NOT NULL CHECK (length(secret_hash) = 64),
  -- app:       knop op de hulppagina zonder (actief) bandje
  -- wristband: hulppagina geopend met een actief polsbandje
  -- reader:    bandje getikt op de lezer van een vrijwilliger
  source TEXT NOT NULL CHECK (source IN ('app', 'wristband', 'reader')),
  wristband_id TEXT REFERENCES wristbands (id) ON DELETE SET NULL,
  tag_uid TEXT CHECK (tag_uid IS NULL OR length(tag_uid) = 14),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'cancelled')),
  latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accepted_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  accepted_at TEXT,
  cancelled_at TEXT,
  updated_at TEXT NOT NULL,
  CHECK (status <> 'accepted' OR accepted_at IS NOT NULL)
);

CREATE INDEX help_requests_status ON help_requests (status, created_at);
