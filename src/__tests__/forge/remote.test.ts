import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockLogger } = vi.hoisted(() => {
  const logger = {
    child: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    silent: vi.fn(),
    level: 'silent',
  };
  logger.child = vi.fn(() => logger);
  return { mockLogger: logger };
});

vi.mock('../../utils/logger.js', () => ({ rootLogger: mockLogger }));

vi.mock('../../config.js', () => ({
  config: {
    syntaro: { label: 'syntaro:fix' },
    forge: { appId: '', jwksUrl: '', skipFitVerify: true },
  },
}));

vi.mock('../../audit/middleware.js', () => ({ auditLog: vi.fn() }));

const mockRepo = vi.hoisted(() => ({
  findByInstallationId: vi.fn().mockResolvedValue(undefined),
  findByWorkspace: vi.fn().mockResolvedValue(undefined),
  upsert: vi.fn().mockResolvedValue({}),
  rotateToken: vi.fn().mockResolvedValue(true),
  setWorkspace: vi.fn().mockResolvedValue(true),
  delete: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../db/repositories/BitbucketForgeInstallationRepository.js', () => ({
  bitbucketForgeInstallationRepository: mockRepo,
}));

vi.mock('../../utils/encryption.js', () => ({
  encrypt: (t: string) => `enc:${t}`,
  decrypt: (t: string) => t.replace(/^enc:/, ''),
}));

const mockClient = vi.hoisted(() => ({
  getPullRequestComment: vi.fn(),
  getPullRequestDetail: vi.fn(),
  resolveWorkspaceSlug: vi.fn().mockResolvedValue('aimino-tech'),
  createComment: vi.fn().mockResolvedValue(undefined),
  createPullRequest: vi.fn(),
}));

vi.mock('../../platforms/bitbucket/index.js', () => ({
  BitbucketPlatformClient: class {
    constructor(_token: string, _baseUrl?: string) {}
    getPullRequestComment = mockClient.getPullRequestComment;
    getPullRequestDetail = mockClient.getPullRequestDetail;
    resolveWorkspaceSlug = mockClient.resolveWorkspaceSlug;
    createComment = mockClient.createComment;
    createPullRequest = mockClient.createPullRequest;
  },
}));

import express from 'express';
import jwt from 'jsonwebtoken';
import { extractForgeContext } from '../../forge/fit.js';
import { createForgeRemoteRouter, parseSyntaroCommand } from '../../forge/remote.js';

const FIT_PAYLOAD = {
  app: {
    id: 'ari:cloud:ecosystem::app/test-app',
    apiBaseUrl: 'https://api.atlassian.com/ex/bitbucket/ctx-1',
    installationId: 'ari:cloud:ecosystem::installation/inst-1',
  },
};

function makeTokens() {
  const fit = jwt.sign(FIT_PAYLOAD, 'test-secret');
  const system = jwt.sign({ exp: Math.floor(Date.now() / 1000) + 3600 }, 'test-secret');
  return { fit, system };
}

const WORKSPACE = '{4c16a397-8e48-479c-8ca2-442e46c90570}';

function commentEvent(overrides: Record<string, unknown> = {}) {
  return {
    eventType: 'avi:bitbucket:created:pullrequest-comment',
    selfGenerated: false,
    actor: { type: 'user', accountId: 'u1', uuid: '{u1}' },
    repository: { uuid: '{r1}', slug: 'repo-a' },
    workspace: { uuid: WORKSPACE },
    pullrequest: {
      id: 4,
      state: 'OPEN',
      source: { branch: 'feature/x', commit: { hash: 'abc' } },
      destination: { branch: 'main', commit: { hash: 'def' } },
      title: { truncated: false, value: 'Fix login bug' },
    },
    comment: { id: 987 },
    ...overrides,
  };
}

describe('parseSyntaroCommand', () => {
  it('matches /syntaro fix', () => {
    expect(parseSyntaroCommand('/syntaro fix')).toEqual({ command: 'fix' });
    expect(parseSyntaroCommand('  /syntaro Fix with trailing')).toEqual({ command: 'fix' });
  });

  it('matches /syntaro review', () => {
    expect(parseSyntaroCommand('/syntaro review')).toEqual({ command: 'review' });
  });

  it('rejects non-commands and empty text', () => {
    expect(parseSyntaroCommand('just a normal comment')).toBeNull();
    expect(parseSyntaroCommand('')).toBeNull();
    expect(parseSyntaroCommand(null)).toBeNull();
    expect(parseSyntaroCommand('/syntarofix')).toBeNull();
  });
});

describe('extractForgeContext (skipFitVerify)', () => {
  it('extracts app claims + system token expiry', async () => {
    const { fit, system } = makeTokens();
    const ctx = await extractForgeContext(`Bearer ${fit}`, system);
    expect(ctx.appId).toBe(FIT_PAYLOAD.app.id);
    expect(ctx.installationId).toBe(FIT_PAYLOAD.app.installationId);
    expect(ctx.apiBaseUrl).toBe(FIT_PAYLOAD.app.apiBaseUrl);
    expect(ctx.systemToken).toBe(system);
    expect(ctx.systemTokenExpiresAt).toBeInstanceOf(Date);
  });

  it('rejects missing FIT', async () => {
    await expect(extractForgeContext(undefined, 'tok')).rejects.toThrow('Missing FIT');
  });

  it('rejects missing system token', async () => {
    const { fit } = makeTokens();
    await expect(extractForgeContext(`Bearer ${fit}`, undefined)).rejects.toThrow('Missing x-forge-oauth-system');
  });
});

describe('createForgeRemoteRouter', () => {
  let server: Server;
  let port: number;
  let mockEnqueue: ReturnType<typeof vi.fn>;
  let tokens: { fit: string; system: string };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockRepo.findByInstallationId.mockResolvedValue(undefined);
    mockClient.getPullRequestComment.mockResolvedValue({ content: { raw: '/syntaro fix' } });
    mockClient.getPullRequestDetail.mockResolvedValue({ title: 'Fix login bug', description: 'Users cannot log in' });
    mockClient.resolveWorkspaceSlug.mockResolvedValue('aimino-tech');

    mockEnqueue = vi.fn().mockResolvedValue('job-1');
    const app = express();
    app.use(express.raw({ type: 'application/json' }));
    app.use('/forge/remote', createForgeRemoteRouter(mockEnqueue));

    server = await new Promise<Server>((resolve) => {
      const s = createServer(app);
      s.listen(0, () => resolve(s));
    });
    port = (server.address() as AddressInfo).port;
    tokens = makeTokens();
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function post(path: string, body: unknown) {
    const res = await fetch(`http://127.0.0.1:${port}/forge/remote${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${tokens.fit}`,
        'x-forge-oauth-system': tokens.system,
      },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  }

  it('401 without FIT token', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/forge/remote/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(commentEvent()),
    });
    expect(res.status).toBe(401);
  });

  it('enqueues a PR-completion job on /syntaro fix comment', async () => {
    const { status, json } = await post('/events', commentEvent());
    expect(status).toBe(200);
    expect(json).toEqual({ ok: true, enqueued: true });

    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    const job = mockEnqueue.mock.calls[0][0] as Record<string, unknown>;
    expect(job.source).toBe('bitbucket');
    expect(job.jobKind).toBe('pr-completion');
    expect(job.repoOwner).toBe('aimino-tech');
    expect(job.repoName).toBe('repo-a');
    expect(job.issueNumber).toBe(4);
    expect(job.issueTitle).toBe('Fix login bug');
    expect(job.issueBody).toBe('Users cannot log in');
    expect(job.labels).toEqual(['syntaro:fix']);
    expect(job.forgeInstallationId).toBe(FIT_PAYLOAD.app.installationId);
    expect(job.forgeWorkspaceUuid).toBe(WORKSPACE);

    expect(mockClient.createComment).toHaveBeenCalledWith(
      'aimino-tech/repo-a',
      4,
      expect.stringContaining('working on this pull request'),
    );
    expect(mockRepo.upsert).toHaveBeenCalled();
  });

  it('skips self-generated events', async () => {
    const { status, json } = await post('/events', commentEvent({ selfGenerated: true }));
    expect(status).toBe(200);
    expect(json).toMatchObject({ skipped: 'self-generated' });
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('skips comments that are not SYNTARO commands', async () => {
    mockClient.getPullRequestComment.mockResolvedValue({ content: { raw: 'lgtm!' } });
    const { status, json } = await post('/events', commentEvent());
    expect(status).toBe(200);
    expect(json).toMatchObject({ skipped: 'not-a-syntaro-command' });
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('enqueues when PR description contains the syntaro:fix marker', async () => {
    mockClient.getPullRequestDetail.mockResolvedValue({
      title: 'PR with marker',
      description: 'Please fix this\nsyntaro:fix',
    });
    const { status, json } = await post(
      '/events',
      commentEvent({
        eventType: 'avi:bitbucket:created:pullrequest',
        pullrequest: {
          id: 7,
          state: 'OPEN',
          source: { branch: 'f', commit: { hash: 'a' } },
          destination: { branch: 'main', commit: { hash: 'b' } },
          title: { truncated: false, value: 'PR with marker' },
        },
      }),
    );
    expect(status).toBe(200);
    expect(json).toEqual({ ok: true, enqueued: true });
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
  });

  it('registers installation on lifecycle event', async () => {
    const { status, json } = await post('/lifecycle', {
      id: 'lifecycle-1',
      installerAccountId: 'u1',
      app: { id: 'ari:cloud:ecosystem::app/test-app' },
    });
    expect(status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(mockRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ installationId: FIT_PAYLOAD.app.installationId }),
    );
  });

  it('removes installation on preUninstall', async () => {
    const { status, json } = await post('/uninstall', {});
    expect(status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(mockRepo.delete).toHaveBeenCalledWith(FIT_PAYLOAD.app.installationId);
  });

  it('rotates token on scheduled refresh', async () => {
    const { status, json } = await post('/token-refresh', {});
    expect(status).toBe(200);
    expect(json).toMatchObject({ ok: true });
    expect(mockRepo.upsert).toHaveBeenCalled();
  });
});
