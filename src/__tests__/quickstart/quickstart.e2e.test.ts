import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const repoRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const tsxCli = join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const cliEntry = join(repoRoot, 'src', 'template', 'cli.ts');

const ISSUE_TITLE = 'STAS Quickstart Demo — Fix Me';
const PR_URL = 'https://github.com/alice/awesome-project/pull/42';

interface ApiCall {
  method: string;
  url: string;
  body?: unknown;
}

describe('stas quickstart --skip-prompts end-to-end (fresh environment)', () => {
  let server: Server;
  let port: number;
  let tempHome: string;
  let calls: ApiCall[] = [];
  let commentCalls = 0;

  async function listen(): Promise<void> {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        calls.push({ method: req.method ?? '', url: url.pathname, body: raw === '' ? undefined : JSON.parse(raw) });

        res.setHeader('content-type', 'application/json');
        if (req.method === 'GET' && url.pathname === '/user') {
          res.end(JSON.stringify({ login: 'alice', id: 1 }));
          return;
        }
        if (req.method === 'GET' && url.pathname === '/user/repos') {
          res.end(
            JSON.stringify([
              {
                name: 'awesome-project',
                full_name: 'alice/awesome-project',
                owner: { login: 'alice' },
                private: false,
              },
            ]),
          );
          return;
        }
        if (req.method === 'POST' && url.pathname === '/repos/alice/awesome-project/issues') {
          res.end(
            JSON.stringify({
              number: 7,
              html_url: 'https://github.com/alice/awesome-project/issues/7',
            }),
          );
          return;
        }
        if (req.method === 'POST' && url.pathname === '/repos/alice/awesome-project/issues/7/labels') {
          res.end(JSON.stringify([]));
          return;
        }
        if (req.method === 'GET' && url.pathname === '/repos/alice/awesome-project/issues/7/comments') {
          commentCalls += 1;
          const body = commentCalls === 1 ? [] : [{ body: `STAS opened ${PR_URL} to fix this` }];
          res.end(JSON.stringify(body));
          return;
        }
        if (req.method === 'GET' && url.pathname === '/repos/alice/awesome-project/pulls') {
          res.end(JSON.stringify([]));
          return;
        }
        res.statusCode = 404;
        res.end(JSON.stringify({ message: 'not found' }));
      });
    });
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Failed to start mock server');
    }
    port = address.port;
  }

  beforeEach(async () => {
    calls = [];
    commentCalls = 0;
    tempHome = mkdtempSync(join(tmpdir(), 'stas-quickstart-e2e-'));
    await listen();
  });

  afterEach(async () => {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    rmSync(tempHome, { recursive: true, force: true });
  });

  it('runs the full quickstart flow against a fresh environment and saves the config', async () => {
    const configDir = join(tempHome, '.config', 'stas');
    const env = {
      ...process.env,
      HOME: tempHome,
      GITHUB_TOKEN: 'ghp_fresh',
      GITHUB_API_URL: `http://127.0.0.1:${port}`,
      STAS_CONFIG_DIR: configDir,
      STAS_OPEN_BROWSER: '0',
      STAS_INSTALL_WAIT_MS: '0',
      STAS_POLL_INTERVAL_MS: '50',
      STAS_TIMEOUT_MS: '5000',
    };

    const { stdout, code } = await new Promise<{ stdout: string; stderr: string; code: number | null }>(
      (resolveRun) => {
        execFile(
          process.execPath,
          [tsxCli, cliEntry, 'quickstart', '--skip-prompts'],
          { env, timeout: 30_000 },
          (error, out, err) => {
            resolveRun({ stdout: out, stderr: err, code: error === null ? 0 : (error.code as number | null) });
          },
        );
      },
    );

    expect(code).toBe(0);
    expect(stdout).toContain('Quickstart complete');
    expect(stdout).toContain(`Your STAS fix PR: ${PR_URL}`);
    expect(stdout).toContain(`Config saved to ${join(configDir, 'config.json')}`);

    const configPath = join(configDir, 'config.json');
    expect(existsSync(configPath)).toBe(true);
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, string>;
    expect(config.githubToken).toBe('ghp_fresh');
    expect(config.installUrl).toBe('https://github.com/apps/stas/installations/new');
    expect(config.poweredBy).toBe('STAS — AI bug fixes for your repo');

    const createCall = calls.find(
      (call) => call.method === 'POST' && call.url === '/repos/alice/awesome-project/issues',
    );
    expect(createCall).toBeDefined();
    const issueBody = createCall?.body as { title?: string; body?: string; labels?: unknown };
    expect(issueBody.title).toBe(ISSUE_TITLE);
    expect(issueBody.body).toContain('STAS — AI bug fixes for your repo');

    const labelCall = calls.find(
      (call) => call.method === 'POST' && call.url === '/repos/alice/awesome-project/issues/7/labels',
    );
    expect((labelCall?.body as { labels?: string[] }).labels).toEqual(['stas:fix']);
  }, 30_000);
});
