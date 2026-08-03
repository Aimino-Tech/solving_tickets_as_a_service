/**
 * Synthetic E2E Check - full pipeline health verification.
 */
import { rootLogger } from '../utils/logger.js';
const log = rootLogger.child({ module: 'synthetic-check' });

export interface SyntheticCheckConfig {
  syntheticRepo: string;
  syntheticIssue: number;
  githubToken: string;
  heartbeatUrl?: string;
  heartbeatFailUrl?: string;
  timeoutMs: number;
  pollIntervalMs: number;
}

function getConfig(): SyntheticCheckConfig {
  return {
    syntheticRepo: process.env.SYNTARO_SYNTHETIC_REPO ?? 'syntaro-bot/synthetic-test',
    syntheticIssue: Number(process.env.SYNTARO_SYNTHETIC_ISSUE) || 1,
    githubToken: process.env.GITHUB_TOKEN ?? '',
    heartbeatUrl: process.env.HEARTBEAT_URL,
    heartbeatFailUrl: process.env.HEARTBEAT_FAIL_URL,
    timeoutMs: Number(process.env.SYNTHETIC_TIMEOUT_MS) || 300_000,
    pollIntervalMs: Number(process.env.SYNTHETIC_POLL_INTERVAL_MS) || 15_000,
  };
}

export async function runSyntheticE2ECheck(partial?: Partial<SyntheticCheckConfig>): Promise<{ passed: boolean; durationMs: number; errorSummary?: string }> {
  const cfg: SyntheticCheckConfig = { ...getConfig(), ...partial };
  const start = Date.now();
  log.info({ repo: cfg.syntheticRepo }, 'Starting check');
  if (!cfg.githubToken) return { passed: false, durationMs: Date.now() - start, errorSummary: 'No GITHUB_TOKEN' };
  const h = { Authorization: 'Bearer ' + cfg.githubToken, Accept: 'application/vnd.github.v3+json' };
  try {
    const r = await fetch('https://api.github.com/repos/' + cfg.syntheticRepo + '/issues/' + cfg.syntheticIssue + '/labels',
      { method: 'POST', headers: h, body: JSON.stringify({ labels: ['syntaro:fix'] }) });
    if (![200, 201, 422].includes(r.status)) throw new Error('Label: ' + r.status);
  } catch (e: any) { return { passed: false, durationMs: Date.now() - start, errorSummary: e.message }; }
  try {
    const dl = Date.now() + 60000;
    while (Date.now() < dl) {
      const r = await fetch('https://api.github.com/repos/' + cfg.syntheticRepo + '/issues/' + cfg.syntheticIssue + '/comments', { headers: h });
      if (r.ok && (await r.json()).some((x: any) => x.body?.includes('working on it'))) break;
      await new Promise(r => setTimeout(r, 5000));
    }
    if (Date.now() >= dl) throw new Error('No ack');
  } catch (e: any) { return { passed: false, durationMs: Date.now() - start, errorSummary: e.message }; }
  let prUrl = '';
  try {
    const dl = Date.now() + cfg.timeoutMs;
    while (Date.now() < dl) {
      const r = await fetch('https://api.github.com/repos/' + cfg.syntheticRepo + '/pulls?state=all&per_page=10', { headers: h });
      if (r.ok) { const p = await r.json(); const m = p.find((x: any) => x.title?.includes('[Synthetic]')); if (m) { prUrl = m.html_url ?? ''; break; } }
      await new Promise(r => setTimeout(r, cfg.pollIntervalMs));
    }
    if (!prUrl) throw new Error('No PR');
  } catch (e: any) { return { passed: false, durationMs: Date.now() - start, errorSummary: e.message }; }
  if (cfg.heartbeatUrl) { try { await fetch(cfg.heartbeatUrl); } catch {} }
  return { passed: true, durationMs: Date.now() - start };
}

const m = process.argv[1];
if (m && (m.endsWith('/syntheticCheck.ts') || m.endsWith('/syntheticCheck.js')))
  runSyntheticE2ECheck().then(r => { console.log(JSON.stringify(r)); process.exit(r.passed ? 0 : 1); });
