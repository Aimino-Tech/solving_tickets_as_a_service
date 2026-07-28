import type { FullConfig } from '@playwright/test';

const STAS_URL = process.env.STAS_URL || 'http://localhost:3000';
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
  console.log('\n[SETUP] Checking STAS (FE) and OpenSymphony (BE) connectivity...\n');

  const stasAlive = await checkService(`${STAS_URL}/health`, 'STAS');
  const osyAlive = await checkService(`${OSY_URL}/healthz`, 'OpenSymphony');

  process.env.__STAS_ALIVE__ = String(stasAlive);
  process.env.__OSY_ALIVE__ = String(osyAlive);

  console.log(`[SETUP] STAS (${STAS_URL}): ${stasAlive ? 'alive' : 'unreachable'}`);
  console.log(`[SETUP] OpenSymphony (${OSY_URL}): ${osyAlive ? 'alive' : 'unreachable'}`);

  if (!stasAlive) {
    console.warn('[SETUP] WARNING: STAS is not running. FE tests will fail.');
  }
  if (stasAlive && osyAlive) {
    console.log('[SETUP] Both FE and BE are connected and operational!\n');
  } else {
    console.log('[SETUP] Some services are unavailable. Integration tests will be skipped.\n');
  }
}

export default globalSetup;
