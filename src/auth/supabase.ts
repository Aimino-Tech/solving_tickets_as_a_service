import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export const supabaseJwtSecret: string = process.env.SUPABASE_JWT_SECRET || '';

function missingMsg(key: string): string {
  return `Supabase credentials not configured. Set ${key}.`;
}

function getAdminClient() {
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error(missingMsg('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY'));
  }
  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function getAnonClient() {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(missingMsg('SUPABASE_URL and SUPABASE_ANON_KEY'));
  }
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

let _adminClient: ReturnType<typeof getAdminClient> | null = null;
let _anonClient: ReturnType<typeof getAnonClient> | null = null;

export function getSupabaseAdmin() {
  if (!_adminClient) _adminClient = getAdminClient();
  return _adminClient;
}

export function getSupabaseAnon() {
  if (!_anonClient) _anonClient = getAnonClient();
  return _anonClient;
}
