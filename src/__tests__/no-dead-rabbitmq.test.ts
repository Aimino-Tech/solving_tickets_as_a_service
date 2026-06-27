/**
 * Verification test: No dead RabbitMQ/amqplib code remains.
 *
 * Confirms that the RabbitMQ stub (src/queue/rabbitmq.ts), its integration
 * test (tests/rabbitmq-integration.test.ts), and all amqplib imports have
 * been removed. The active queue system is BullMQ (Redis-based).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const PROJECT_ROOT = new URL('../..', import.meta.url).pathname;

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

describe('no dead RabbitMQ (amqplib) code', () => {
  it('src/queue/rabbitmq.ts stub has been removed', () => {
    expect(existsSync(`${PROJECT_ROOT}/src/queue/rabbitmq.ts`)).toBe(false);
  });

  it('tests/rabbitmq-integration.test.ts has been removed', () => {
    expect(existsSync(`${PROJECT_ROOT}/tests/rabbitmq-integration.test.ts`)).toBe(false);
  });

  it('no amqplib imports remain in src/ or tests/', () => {
    const tsFiles = [
      ...findTsFiles(`${PROJECT_ROOT}/src`),
      ...findTsFiles(`${PROJECT_ROOT}/tests`),
    ];
    const offenders: string[] = [];
    const allowedFiles = [
      'no-dead-rabbitmq.test.ts',
      'async-execution.ts',
      'async-execution.test.ts',
    ];

    for (const file of tsFiles) {
      // Skip our own test file and the new async-execution implementation
      if (allowedFiles.some(f => file.endsWith(f))) continue;
      const content = readFileSync(file, 'utf-8');
      if (content.includes("from 'amqplib'") || content.includes('require("amqplib")') || content.includes("require('amqplib')")) {
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
});
