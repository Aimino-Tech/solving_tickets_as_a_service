import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';

const PROJECT_ROOT = new URL('../..', import.meta.url).pathname;

describe('RabbitMQ module integrity', () => {
  it('src/queue/rabbitmq.ts exists (RabbitMQ is the active backend)', () => {
    expect(existsSync(`${PROJECT_ROOT}/src/queue/rabbitmq.ts`)).toBe(true);
  });

  it('src/queue/rabbitmqIssueQueue.ts exists', () => {
    expect(existsSync(`${PROJECT_ROOT}/src/queue/rabbitmqIssueQueue.ts`)).toBe(true);
  });

  it('src/queue/repoLock.ts exists', () => {
    expect(existsSync(`${PROJECT_ROOT}/src/queue/repoLock.ts`)).toBe(true);
  });

  it('src/queue/heartbeat.ts exists', () => {
    expect(existsSync(`${PROJECT_ROOT}/src/queue/heartbeat.ts`)).toBe(true);
  });

  it('No bullmq imports remain in src/queue/', () => {
    const queueFiles = ['issueQueue.ts', 'rabbitmqIssueQueue.ts', 'deadLetterQueue.ts', 'queueMonitor.ts', 'repoLock.ts', 'heartbeat.ts'];
    const offenders: string[] = [];

    for (const file of queueFiles) {
      const path = `${PROJECT_ROOT}/src/queue/${file}`;
      if (!existsSync(path)) continue;
      const content = readFileSync(path, 'utf-8');
      if (content.includes("from 'bullmq'") || content.includes('require("bullmq")') || content.includes("require('bullmq')")) {
        offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
  });
});
