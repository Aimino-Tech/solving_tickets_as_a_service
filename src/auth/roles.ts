import { queryWithRetry } from '../db/connection.js';
import { rootLogger } from '../utils/logger.js';
import { getSupabaseAdmin } from './supabase.js';

const log = rootLogger.child({ module: 'auth-roles' });

export type PlatformRole = 'admin' | 'user';

/**
 * Resolve platform role from public.users (source of truth), then Supabase app_metadata.
 * Optionally sync app_metadata when DB and Auth disagree.
 */
export async function resolvePlatformRole(opts: {
  userId: string;
  email?: string;
  appMetadataRole?: string | null;
  syncToSupabase?: boolean;
}): Promise<PlatformRole> {
  let role: PlatformRole = opts.appMetadataRole === 'admin' ? 'admin' : 'user';

  try {
    const byId = await queryWithRetry<{ role: string }>(
      'SELECT role FROM users WHERE id = $1 LIMIT 1',
      [opts.userId],
    );
    if (byId.rows[0]?.role === 'admin' || byId.rows[0]?.role === 'user') {
      role = byId.rows[0].role as PlatformRole;
    } else if (opts.email) {
      const byEmail = await queryWithRetry<{ role: string }>(
        'SELECT role FROM users WHERE email = $1 LIMIT 1',
        [opts.email.toLowerCase()],
      );
      if (byEmail.rows[0]?.role === 'admin' || byEmail.rows[0]?.role === 'user') {
        role = byEmail.rows[0].role as PlatformRole;
      }
    }
  } catch (err) {
    log.warn({ err: String(err), userId: opts.userId }, 'Failed to read users.role');
  }

  if (opts.syncToSupabase && role !== (opts.appMetadataRole ?? 'user')) {
    try {
      await getSupabaseAdmin().auth.admin.updateUserById(opts.userId, {
        app_metadata: { role },
      });
    } catch (err) {
      log.warn({ err: String(err), userId: opts.userId }, 'Failed to sync role to Supabase app_metadata');
    }
  }

  return role;
}
