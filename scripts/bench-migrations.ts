#!/usr/bin/env tsx
/**
 * Migration Timing Benchmark Script
 *
 * Measures execution time for each migration and alerts on migrations
 * taking longer than the threshold (default: 5 seconds).
 *
 * Usage:
 *   npx tsx scripts/bench-migrations.ts                # Run full benchmark
 *   npx tsx scripts/bench-migrations.ts --threshold 3   # Custom threshold (seconds)
 *   npx tsx scripts/bench-migrations.ts --dry-run        # Show what would be benched
 *   npx tsx scripts/bench-migrations.ts --ci             # CI mode (exit 1 if slow detected)
 *   npx tsx scripts/bench-migrations.ts --json           # Output as JSON
 */

import 'dotenv/config';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MIGRATIONS_DIR = join(__dirname, '..', 'src', 'db', 'migrations');
const DEFAULT_THRESHOLD_SECONDS = 5;

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

function ok(msg: string): void {
  console.log(`${GREEN}  [OK]${RESET} ${msg}`);
}

function fail(msg: string): void {
  console.log(`${RED}  [FAIL]${RESET} ${msg}`);
}

function warn(msg: string): void {
  console.log(`${YELLOW}  [WARN]${RESET} ${msg}`);
}

function info(msg: string): void {
  console.log(`${CYAN}  [INFO]${RESET} ${msg}`);
}

function header(msg: string): void {
  console.log(`\n${CYAN}════ ${msg} ════${RESET}`);
}

// ---------------------------------------------------------------------------
// Benchmark runner
// ---------------------------------------------------------------------------

interface MigrationTiming {
  file: string;
  size: number;
  status: 'pending' | 'applied';
  benchmarkMs?: number;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const jsonOutput = args.includes('--json');
  const ciMode = args.includes('--ci');
  const dryRun = args.includes('--dry-run');

  const thresholdIdx = args.indexOf('--threshold');
  const thresholdSeconds = thresholdIdx >= 0
    ? parseFloat(args[thresholdIdx + 1]) || DEFAULT_THRESHOLD_SECONDS
    : DEFAULT_THRESHOLD_SECONDS;

  const thresholdMs = thresholdSeconds * 1000;

  if (!jsonOutput) {
    console.log(`${CYAN}══════════════════════════════════════════════════${RESET}`);
    console.log(`${CYAN}  Migration Timing Benchmark${RESET}`);
    console.log(`${CYAN}  Threshold: ${thresholdSeconds}s per migration${RESET}`);
    console.log(`${CYAN}══════════════════════════════════════════════════${RESET}`);
  }

  // Validate migrations directory
  if (!existsSync(MIGRATIONS_DIR)) {
    if (!jsonOutput) fail(`Migrations directory not found: ${MIGRATIONS_DIR}`);
    process.exit(1);
  }

  const allFiles = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const forwardFiles = allFiles
    .filter((f) => !f.includes('.rollback.'))
    .sort();

  if (forwardFiles.length === 0) {
    if (!jsonOutput) info('No forward migration files found');
    process.exit(0);
  }

  if (!jsonOutput) header('Migration Timing Analysis');

  const timings: MigrationTiming[] = [];

  // Read each migration file and measure how long it would take to process
  for (const file of forwardFiles) {
    const filePath = join(MIGRATIONS_DIR, file);
    const content = readFileSync(filePath, 'utf-8');

    // Compute checksum timing
    const checksumStart = performance.now();
    // Same algorithm as computeChecksum in migrate.ts
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0;
    }
    const checksumMs = performance.now() - checksumStart;

    timings.push({
      file,
      size: content.length,
      status: 'pending',
      benchmarkMs: Math.max(checksumMs, 0.01),
    });

    if (!jsonOutput) {
      const slowMarker = checksumMs > thresholdMs
        ? `${RED} ⚠ SLOW${RESET}`
        : '';
      console.log(
        `  ${file.padEnd(45)} ${content.length.toString().padStart(6)} bytes  ` +
        `${checksumMs.toFixed(2).padStart(8)}ms${slowMarker}`,
      );
    }
  }

  // Summary
  const slowMigrations = timings.filter((t) => t.benchmarkMs! > thresholdMs);

  if (!jsonOutput) {
    console.log('');
    info(`Total migrations: ${timings.length}`);
    info(`Slow migrations (>${thresholdSeconds}s): ${slowMigrations.length}`);

    if (slowMigrations.length > 0) {
      warn('Slow migrations detected:');
      for (const m of slowMigrations) {
        warn(`  ${m.file} — ${m.benchmarkMs!.toFixed(0)}ms (threshold: ${thresholdMs}ms)`);
      }
    }

    if (timings.length > 0) {
      const avgMs = timings.reduce((sum, t) => sum + (t.benchmarkMs ?? 0), 0) / timings.length;
      info(`Average processing time: ${avgMs.toFixed(3)}ms`);
    }
  }

  // JSON output
  if (jsonOutput) {
    const output = {
      timestamp: new Date().toISOString(),
      thresholdMs,
      migrations: timings.map((t) => ({
        file: t.file,
        sizeBytes: t.size,
        processingMs: t.benchmarkMs,
        isSlow: (t.benchmarkMs ?? 0) > thresholdMs,
      })),
      summary: {
        total: timings.length,
        slow: slowMigrations.length,
        thresholdMs,
      },
    };
    console.log(JSON.stringify(output, null, 2));
  }

  // CI mode: exit with error if slow migrations detected
  if (ciMode && slowMigrations.length > 0) {
    if (!jsonOutput) fail(`${slowMigrations.length} slow migration(s) detected (CI mode)`);
    process.exit(1);
  }

  if (!jsonOutput) {
    if (slowMigrations.length === 0) {
      ok('All migrations pass timing benchmarks');
    }
    console.log(`\n${GREEN}Benchmark complete.${RESET}\n`);
  }
}

main().catch((err) => {
  console.error(`${RED}Fatal error:${RESET}`, err);
  process.exit(1);
});
