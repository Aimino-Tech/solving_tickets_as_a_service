/**
 * Verification test: RabbitMQ is intentionally used in the AMQP module.
 *
 * The system intentionally uses RabbitMQ (amqplib) as the queue backend.
 * The intentional module lives in src/queue/amqp/ with its own tests.
 * This test verifies that amqplib imports don't leak into other parts
 * of the codebase outside the designed module boundaries.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const PROJECT_ROOT = new URL('../..', import.meta.url).pathname;

/** Directories where amqplib imports are intentionally allowed. */
const ALLOWED_AMQPLIB_DIRS = [
  join(PROJECT_ROOT, 'src', 'queue', 'amqp'),
  join(PROJECT_ROOT, 'src', '__tests__', 'queue'),
];

/** Files where amqplib imports are intentionally allowed. */
const ALLOWED_AMQPLIB_FILES = [
  join(PROJECT_ROOT, 'src', 'queue', 'rabbitmq.ts'),
];

function findTsFiles(dir: string): string[] {
  const files: string[] = [];
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (entry === 'node_modules') continue;
      try {
        if (statSync(full).isDirectory()) {
          files.push(...findTsFiles(full));
        } else if (full.endsWith('.ts')) {
          files.push(full);
        }
      } catch {
        // skip inaccessible
      }
    }
  } catch {
    // skip inaccessible
  }
  return files;
}

function isAllowedPath(filePath: string): boolean {
  for (const allowedDir of ALLOWED_AMQPLIB_DIRS) {
    if (filePath.startsWith(allowedDir)) return true;
  }
  for (const allowedFile of ALLOWED_AMQPLIB_FILES) {
    if (filePath === allowedFile) return true;
  }
  return false;
}

describe('RabbitMQ is intentionally used in the AMQP module', () => {
  it('src/queue/rabbitmq.ts exists as the intentional RabbitMQ adapter', () => {
    expect(existsSync(`${PROJECT_ROOT}/src/queue/rabbitmq.ts`)).toBe(true);
  });

  it('src/queue/amqp/ directory exists with the modular AMQP implementation', () => {
    expect(existsSync(`${PROJECT_ROOT}/src/queue/amqp/connection.ts`)).toBe(true);
    expect(existsSync(`${PROJECT_ROOT}/src/queue/amqp/producer.ts`)).toBe(true);
    expect(existsSync(`${PROJECT_ROOT}/src/queue/amqp/consumer.ts`)).toBe(true);
    expect(existsSync(`${PROJECT_ROOT}/src/queue/amqp/exchanges.ts`)).toBe(true);
  });

  it('tests/rabbitmq-integration.test.ts has been removed', () => {
    expect(existsSync(`${PROJECT_ROOT}/tests/rabbitmq-integration.test.ts`)).toBe(false);
  });

  it('no amqplib imports exist outside the intentional module paths', () => {
    const tsFiles = [
      ...findTsFiles(`${PROJECT_ROOT}/src`),
      ...findTsFiles(`${PROJECT_ROOT}/tests`),
    ];
    const offenders: string[] = [];

    for (const file of tsFiles) {
      // Skip our own test file which mentions amqplib in comments
      if (file.endsWith('no-dead-rabbitmq.test.ts')) continue;

      // Skip intentionally allowed paths
      if (isAllowedPath(file)) continue;

      const content = readFileSync(file, 'utf-8');
      if (
        content.includes("from 'amqplib'") ||
        content.includes('require("amqplib")') ||
        content.includes("require('amqplib')") ||
        content.includes("import('amqplib')")
      ) {
        offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('dependencies.ts does not import rabbitmq', () => {
    const depsPath = `${PROJECT_ROOT}/src/health/dependencies.ts`;
    const content = readFileSync(depsPath, 'utf-8');
    expect(content).not.toContain('rabbitmq');
  });

  it('admin routes do not import rabbitmq', () => {
    const adminPath = `${PROJECT_ROOT}/src/routes/admin.ts`;
    const content = readFileSync(adminPath, 'utf-8');
    expect(content).not.toContain('rabbitmq');
  });

  it('amqplib is a declared dependency in package.json', () => {
    const pkg = JSON.parse(readFileSync(`${PROJECT_ROOT}/package.json`, 'utf-8'));
    const deps = pkg.dependencies ?? {};
    expect(deps['amqplib']).toBeDefined();
    expect(typeof deps['amqplib']).toBe('string');
  });
});
