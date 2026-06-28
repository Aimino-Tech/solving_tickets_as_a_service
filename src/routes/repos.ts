/**
 * Repository picker API — lists the authenticated user's GitHub repos and
 * their STAS webhook / installation status.
 *
 * Routes (mounted at /api/repos):
 *   GET  /          — List user's repos with webhook status
 *   GET  /:owner/:repo — Get a single repo's status
 *
 * All endpoints rely on governance proxy for auth.
 */

import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
const log = rootLogger.child({ module: 'repos-routes' });

// ---------------------------------------------------------------------------
// Rate Limiting
// ---------------------------------------------------------------------------

const reposLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests', retryAfter: 'see Retry-After header' },
});

const router = Router();

router.use(reposLimiter);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RepoWithStatus {
  id: number;
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
  description: string | null;
  defaultBranch: string;
  language: string | null;
  updatedAt: string;
  /** Whether STAS has a webhook installed on this repo. */
  stasInstalled: boolean;
  /** GitHub App installation ID if installed. */
  installationId: number | null;
  /** The STAS label trigger config for this repo. */
  stasLabel: string;
}

interface GitHubRepo {
  id: number;
  owner: { login: string };
  name: string;
  full_name: string;
  private: boolean;
  description: string | null;
  default_branch: string;
  language: string | null;
  updated_at: string;
}

interface GitHubInstallation {
  id: number;
  account: { login: string };
  repositories_url: string;
  target_type: string;
}

// ---------------------------------------------------------------------------
// GET / — List user's repos
// ---------------------------------------------------------------------------

/**
 * Lists the authenticated user's GitHub repos that they have access to,
 * annotated with STAS installation status.
 *
 * Query params:
 *   type    — all | owner | public | private | member (default: all)
 *   sort    — full_name | created | updated | pushed (default: full_name)
 *   perPage — 1..100 (default: 50)
 *   page    — page number (default: 1)
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const token = resolveToken(req);
    if (!token) {
      res.status(401).json({ error: 'GitHub access token not available — re-authenticate' });
      return;
    }

    const type = (req.query.type as string) || 'all';
    const sort = (req.query.sort as string) || 'full_name';
    const perPage = Math.min(Math.max(1, Number(req.query.perPage) || 50), 100);
    const page = Math.max(1, Number(req.query.page) || 1);

    // Fetch the user's repos from GitHub
    const reposResponse = await fetch(
      `https://api.github.com/user/repos?type=${type}&sort=${sort}&per_page=${perPage}&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'stas-bot',
        },
      },
    );

    if (!reposResponse.ok) {
      log.warn({ status: reposResponse.status }, 'GitHub repos API call failed');
      res.status(reposResponse.status).json({ error: 'GitHub API error', detail: reposResponse.statusText });
      return;
    }

    const repos = (await reposResponse.json()) as GitHubRepo[];

    // Fetch STAS installations to determine which repos have the bot
    const installationsResponse = await fetch(
      'https://api.github.com/user/installations',
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'stas-bot',
        },
      },
    );

    let installedRepos: Set<string> = new Set();
    let installationByRepo: Record<string, number> = {};

    if (installationsResponse.ok) {
      const installationsData = (await installationsResponse.json()) as {
        installations: GitHubInstallation[];
      };

      for (const inst of installationsData.installations) {
        if (inst.target_type === 'User' || inst.target_type === 'Organization') {
          // Fetch repos for this installation
          const instReposResponse = await fetch(inst.repositories_url, {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/vnd.github+json',
              'User-Agent': 'stas-bot',
            },
          });

          if (instReposResponse.ok) {
            const instReposData = (await instReposResponse.json()) as { repositories: GitHubRepo[] };
            for (const repo of instReposData.repositories) {
              installedRepos.add(repo.full_name.toLowerCase());
              installationByRepo[repo.full_name.toLowerCase()] = inst.id;
            }
          }
        }
      }
    }

    // Build response
    const result: RepoWithStatus[] = repos.map((repo) => {
      const fullName = repo.full_name.toLowerCase();
      return {
        id: repo.id,
        owner: repo.owner.login,
        name: repo.name,
        fullName: repo.full_name,
        private: repo.private,
        description: repo.description,
        defaultBranch: repo.default_branch,
        language: repo.language,
        updatedAt: repo.updated_at,
        stasInstalled: installedRepos.has(fullName),
        installationId: installationByRepo[fullName] ?? null,
        stasLabel: config.stas.label,
      };
    });

    // Parse pagination headers
    const linkHeader = reposResponse.headers.get('link') ?? '';
    const totalPages = parseLinkHeader(linkHeader).last ?? page;

    res.json({
      data: result,
      page,
      perPage,
      totalPages,
      total: result.length, // GitHub doesn't give us a total count on this endpoint
      stasLabel: config.stas.label,
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to list repos');
    res.status(500).json({ error: 'Failed to list repos' });
  }
});

// ---------------------------------------------------------------------------
// GET /:owner/:repo — Single repo status
// ---------------------------------------------------------------------------

router.get('/:owner/:repo', async (req: Request, res: Response) => {
  try {
    const token = resolveToken(req);
    if (!token) {
      res.status(401).json({ error: 'GitHub access token not available' });
      return;
    }

    const { owner, repo } = req.params;

    const repoResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'stas-bot',
      },
    });

    if (!repoResponse.ok) {
      if (repoResponse.status === 404) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }
      res.status(repoResponse.status).json({ error: 'GitHub API error' });
      return;
    }

    const repoData = (await repoResponse.json()) as GitHubRepo;

    // Check if STAS webhook is installed
    const hooksResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/hooks`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'stas-bot',
        },
      },
    );

    let stasInstalled = false;
    let installationId: number | null = null;

    if (hooksResponse.ok) {
      const hooks = (await hooksResponse.json()) as Array<{ config: { url?: string }; id: number }>;
      const stasHook = hooks.find((h) => h.config.url?.includes('stas') || h.config.url?.includes(config.github.webhookPath));
      if (stasHook) {
        stasInstalled = true;
        installationId = stasHook.id;
      }
    }

    // Also check installations
    if (!stasInstalled) {
      const instResponse = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/installation`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'stas-bot',
          },
        },
      );
      if (instResponse.ok) {
        const instData = (await instResponse.json()) as { id: number };
        stasInstalled = true;
        installationId = instData.id;
      }
    }

    const result: RepoWithStatus = {
      id: repoData.id,
      owner: repoData.owner.login,
      name: repoData.name,
      fullName: repoData.full_name,
      private: repoData.private,
      description: repoData.description,
      defaultBranch: repoData.default_branch,
      language: repoData.language,
      updatedAt: repoData.updated_at,
      stasInstalled,
      installationId,
      stasLabel: config.stas.label,
    };

    res.json(result);
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get repo status');
    res.status(500).json({ error: 'Failed to get repo status' });
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the GitHub OAuth access token from the session.
 * The token is stored in the user's auth session — for this we fall back
 * to the GitHub App installation token or the configured app.
 */
function resolveToken(req: Request): string | null {
  // For now, we try the Authorization header (Bearer token from OAuth)
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  // Also check cookies
  const raw = req.headers.cookie;
  if (raw) {
    for (const part of raw.split(';')) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      const key = part.slice(0, eq).trim();
      const val = part.slice(eq + 1).trim();
      if (key === 'stas_token' && val) {
        return val;
      }
    }
  }

  return null;
}

/**
 * Parse a GitHub Link header into a map of rel -> page number.
 */
function parseLinkHeader(header: string): Record<string, number> {
  const result: Record<string, number> = {};
  if (!header) return result;

  for (const part of header.split(',')) {
    const match = part.match(/<[^?]*\?.*[?&]page=(\d+)>;\s*rel="(\w+)"/);
    if (match) {
      result[match[2]] = Number(match[1]);
    }
  }
  return result;
}

export { router as reposRouter };
