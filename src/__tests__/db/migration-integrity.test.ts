import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'db', 'migrations');

const migrationFiles = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();

const forwardFiles = migrationFiles.filter((f) => !f.includes('.rollback.'));
const rollbackFiles = migrationFiles.filter((f) => f.includes('.rollback.'));

describe('migration file integrity', () => {
  it('has at least one migration file', () => {
    expect(forwardFiles.length).toBeGreaterThan(0);
  });

  it('every forward migration has a matching rollback', () => {
    for (const fwd of forwardFiles) {
      const expectedRollback = fwd.replace('.sql', '.rollback.sql');
      expect(rollbackFiles).toContain(expectedRollback);
    }
  });

  it('every rollback file has a matching forward migration', () => {
    for (const rb of rollbackFiles) {
      const expectedForward = rb.replace('.rollback.sql', '.sql');
      expect(forwardFiles).toContain(expectedForward);
    }
  });

  it('migration filenames follow the NNN_description.sql convention', () => {
    const pattern = /^\d{3}_.+\.sql$/;
    for (const f of forwardFiles) {
      expect(f).toMatch(pattern);
    }
  });

  it('rollback filenames follow the NNN_description.rollback.sql convention', () => {
    const pattern = /^\d{3}_.+\.rollback\.sql$/;
    for (const f of rollbackFiles) {
      expect(f).toMatch(pattern);
    }
  });

  it('migrations are ordered sequentially (no gaps, no out-of-order)', () => {
    const numbers = forwardFiles.map((f) => parseInt(f.slice(0, 3), 10));
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
    expect(forwardFiles).toEqual([...forwardFiles].sort());
  });

  it('all forward migration files are non-empty', () => {
    for (const f of forwardFiles) {
      const content = readFileSync(join(MIGRATIONS_DIR, f), 'utf-8');
      expect(content.trim().length).toBeGreaterThan(0);
    }
  });

  it('all rollback migration files are non-empty', () => {
    for (const f of rollbackFiles) {
      const content = readFileSync(join(MIGRATIONS_DIR, f), 'utf-8');
      expect(content.trim().length).toBeGreaterThan(0);
    }
  });

  it('forward migrations contain valid SQL statements', () => {
    const validKeywords = /\b(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|BEGIN|COMMIT|DO|SELECT)\b/i;
    for (const f of forwardFiles) {
      const content = readFileSync(join(MIGRATIONS_DIR, f), 'utf-8');
      expect(content).toMatch(validKeywords);
    }
  });

  it('rollback migrations contain DROP statements for cleanup', () => {
    for (const f of rollbackFiles) {
      const content = readFileSync(join(MIGRATIONS_DIR, f), 'utf-8');
      expect(content).toMatch(/\bDROP\b/i);
    }
  });

  it('version numbers form a contiguous sequence when deduplicated', () => {
    const numbers = [...new Set(forwardFiles.map((f) => parseInt(f.slice(0, 3), 10)))].sort((a, b) => a - b);
    for (let i = 0; i < numbers.length; i++) {
      expect(numbers[i]).toBe(i + 1);
    }
  });
});

const SUPABASE_MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'supabase', 'migrations');

const supabaseFiles = readdirSync(SUPABASE_MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();
const supabaseForward = supabaseFiles.filter((f) => !f.includes('.rollback.'));
const supabaseRollback = supabaseFiles.filter((f) => f.includes('.rollback.'));

describe('supabase user-domain migration integrity', () => {
  it('has user-domain forward migrations', () => {
    expect(supabaseForward.length).toBeGreaterThanOrEqual(8);
  });

  it('every supabase forward migration has a matching rollback', () => {
    for (const fwd of supabaseForward) {
      expect(supabaseRollback).toContain(fwd.replace('.sql', '.rollback.sql'));
    }
  });

  it('listMigrationEntries puts supabase entries first with prefix', async () => {
    const { listMigrationEntries } = await import('../../db/migrate.js');
    const entries = listMigrationEntries();
    const supabaseEntries = entries.filter((e) => e.name.startsWith('supabase/'));
    const opsEntries = entries.filter((e) => !e.name.startsWith('supabase/'));

    expect(supabaseEntries.length).toBe(supabaseForward.length);
    expect(supabaseEntries[0].name).toMatch(/^supabase\/013_/);
    expect(entries[0].name.startsWith('supabase/')).toBe(true);
    if (opsEntries.length > 0) {
      const firstOpsIdx = entries.findIndex((e) => !e.name.startsWith('supabase/'));
      const lastSupabaseIdx = entries.map((e) => e.name.startsWith('supabase/')).lastIndexOf(true);
      expect(lastSupabaseIdx).toBeLessThan(firstOpsIdx);
    }
  });

  it('canonical tables appear in supabase DDL', () => {
    const joined = supabaseForward
      .map((f) => readFileSync(join(SUPABASE_MIGRATIONS_DIR, f), 'utf-8'))
      .join('\n');
    for (const table of [
      'users',
      'accounts',
      'credit_balances',
      'credit_transactions',
      'billing',
      'teams',
      'team_members',
      'referral_codes',
      'refresh_tokens',
    ]) {
      expect(joined).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
    }
  });
});
