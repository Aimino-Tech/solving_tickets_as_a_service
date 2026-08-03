import type { FullConfig } from '@playwright/test';

const SYNTARO_URL = process.env.SYNTARO_URL || 'http://localhost:3000';
const OSY_URL = process.env.OSY_URL || 'http://localhost:4096';

async function checkService(url: string, name: string, maxRetries = 10): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(3000) });
      // Accept 2xx or 503 (degraded but alive)
      if (resp.ok || resp.status === 503) {
        return true;
      }
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function globalSetup(_config: FullConfig): Promise<void> {
  console.log('\n[SETUP] Checking SYNTARO (FE) and OpenSymphony (BE) connectivity...\n');

  const syntaroAlive = await checkService(`${SYNTARO_URL}/health`, 'SYNTARO');
  const osyAlive = await checkService(`${OSY_URL}/healthz`, 'OpenSymphony');

  process.env.__SYNTARO_ALIVE__ = String(syntaroAlive);
  process.env.__OSY_ALIVE__ = String(osyAlive);

  console.log(`[SETUP] SYNTARO (${SYNTARO_URL}): ${syntaroAlive ? 'alive' : 'unreachable'}`);
  console.log(`[SETUP] OpenSymphony (${OSY_URL}): ${osyAlive ? 'alive' : 'unreachable'}`);

  if (!syntaroAlive) {
    console.warn('[SETUP] WARNING: SYNTARO is not running. FE tests will fail.');
  }
  if (syntaroAlive && osyAlive) {
    console.log('[SETUP] Both FE and BE are connected and operational!\n');
  } else {
    console.log('[SETUP] Some services are unavailable. Integration tests will be skipped.\n');
  }
}

export default globalSetup;
