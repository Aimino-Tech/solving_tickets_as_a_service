-- AIM-4631 rollback: drop incidents tables

BEGIN;

DROP TABLE IF EXISTS service_catalog;
DROP TABLE IF EXISTS incident_repos;
DROP TABLE IF EXISTS incident_timeline;
DROP TABLE IF EXISTS incidents;

COMMIT;
