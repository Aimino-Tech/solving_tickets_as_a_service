import { beforeAll, afterAll, describe, it } from 'vitest';
import { createTestHarness } from './harness/index.js';

let harness: Awaited<ReturnType<typeof createTestHarness>>;
let started = false;

beforeAll(async () => { harness = await createTestHarness({ verbose: false }); started = true; console.log('READY', harness.baseUrl); }, 30_000);
afterAll(async () => { if (started) await harness.stop(); }, 10_000);

describe('probe', () => {
  it('endpoints', async () => {
    for (const p of ['/health', '/', '/api/v1/auth/me', '/webhook']) {
      const t0 = Date.now();
      try {
        const res = await fetch(`${harness.baseUrl}${p}`, { method: p === '/webhook' ? 'POST' : 'GET', signal: AbortSignal.timeout(5000) });
        console.log(`ENDPOINT ${p} -> ${res.status} in ${Date.now() - t0}ms`);
      } catch (e) {
        console.log(`ENDPOINT ${p} -> ERROR in ${Date.now() - t0}ms: ${e.message.slice(0, 60)}`);
      }
    }
  }, 40_000);
});
