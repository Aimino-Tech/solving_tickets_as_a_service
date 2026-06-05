/**
 * IP allowlist middleware for webhook endpoints.
 *
 * When `IP_ALLOWLIST_ENABLED=true` and `IP_ALLOWLIST` contains a comma-separated
 * list of IPs/CIDR ranges, only requests from those addresses are allowed.
 *
 * Useful when running behind a reverse proxy and you know the source IPs
 * of your webhook providers (GitHub, GitLab, Stripe, etc.).
 *
 * Usage:
 *   ```ts
 *   import { ipAllowlistMiddleware } from './security/ipAllowlist.js';
 *   app.use('/webhook', ipAllowlistMiddleware);
 *   ```
 */

import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'ip-allowlist' });

/**
 * Parse a CIDR notation string into an address and a prefix length.
 * Supports both IPv4 and IPv6.
 */
function parseCIDR(cidr: string): { address: string; prefix: number; family: 'ipv4' | 'ipv6' } | null {
  const parts = cidr.trim().split('/');
  if (parts.length !== 2) return null;

  const prefix = parseInt(parts[1], 10);
  if (Number.isNaN(prefix) || prefix < 0 || prefix > 128) return null;

  const address = parts[0];
  // Simple heuristic: IPv6 contains colons
  const family = address.includes(':') ? 'ipv6' : 'ipv4';

  return { address, prefix, family };
}

/**
 * Convert an IPv4 address to a 32-bit integer for CIDR matching.
 */
function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

/**
 * Check if an IPv4 address is within a CIDR range.
 */
function ipv4InCIDR(ip: string, cidr: string): boolean {
  const parsed = parseCIDR(cidr);
  if (!parsed || parsed.family !== 'ipv4') return false;

  const ipInt = ipv4ToInt(ip);
  const cidrInt = ipv4ToInt(parsed.address);
  const mask = parsed.prefix === 0 ? 0 : ~(2 ** (32 - parsed.prefix) - 1);

  return (ipInt & mask) === (cidrInt & mask);
}

/**
 * Express middleware that rejects requests from IPs not in the allowlist.
 *
 * When IP_ALLOWLIST_ENABLED is false (default), all requests pass through.
 * When enabled but no IP_ALLOWLIST is set, only localhost is allowed.
 */
export function ipAllowlistMiddleware(req: Request, res: Response, next: NextFunction): void {
  const { enabled, ips } = config.security.ipAllowlist;

  if (!enabled) {
    next();
    return;
  }

  // Extract client IP from forwarded header or direct connection
  const forwarded = req.headers['x-forwarded-for'] as string | undefined;
  const clientIp = forwarded?.split(',')[0]?.trim() || req.ip || req.socket.remoteAddress || '';

  // Normalize IPv6 localhost
  const normalizedIp = clientIp === '::1' ? '127.0.0.1' : clientIp;
  const normalizedFam = normalizedIp.includes(':') ? 'ipv6' : 'ipv4';

  if (ips.length === 0) {
    // No IPs configured — allow only localhost when enabled
    if (normalizedIp === '127.0.0.1' || normalizedIp === '::1') {
      next();
      return;
    }
    log.warn({ ip: clientIp, path: req.path }, 'IP not in allowlist (allowlist empty)');
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  for (const entry of ips) {
    if (entry.includes('/')) {
      // CIDR notation
      if (normalizedFam === 'ipv4' && ipv4InCIDR(normalizedIp, entry)) {
        next();
        return;
      }
    } else {
      // Exact IP match
      if (normalizedIp === entry || clientIp === entry) {
        next();
        return;
      }
    }
  }

  log.warn({ ip: clientIp, path: req.path }, 'Request from non-allowlisted IP rejected');
  res.status(403).json({ error: 'Forbidden' });
}
