-- Incident service catalog + resolve-notification state (AIM-4631)
-- The catalog is a STAS-side view of the service→repo mapping used by
-- incident triage; the OpenSymphony registry consumes its own config-based
-- catalog. Repos are stored as an array of "owner/name" strings.

CREATE TABLE IF NOT EXISTS incident_service_catalog (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    repos TEXT[] NOT NULL DEFAULT '{}',
    purpose TEXT,
    runbook TEXT,
    providers TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incident_service_catalog_name ON incident_service_catalog(name);

-- Tracks the last-seen status of each incident fingerprint so the
-- resolve-notification watcher only fires on active→resolved transitions.
CREATE TABLE IF NOT EXISTS incident_status_state (
    fingerprint TEXT PRIMARY KEY,
    status VARCHAR(20) NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
