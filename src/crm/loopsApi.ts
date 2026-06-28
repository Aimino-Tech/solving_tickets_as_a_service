import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import type { LoopsContact, LoopsEvent } from './types.js';

const log = rootLogger.child({ module: 'loops-api' });

const BASE_URL = 'https://app.loops.so/api/v1';

function getHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.crm.loopsApiKey}`,
  };
}

export async function createOrUpdateContact(contact: LoopsContact): Promise<{ success: boolean; id?: string }> {
  try {
    const response = await fetch(`${BASE_URL}/contacts/create-or-update`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(contact),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      log.error({ status: response.status, body }, 'Loops contact sync failed');
      return { success: false };
    }

    const result = await response.json() as { success: boolean; id?: string };
    return result;
  } catch (err) {
    log.error({ err: String(err) }, 'Loops contact sync error');
    return { success: false };
  }
}

export async function sendEvent(event: LoopsEvent): Promise<{ success: boolean }> {
  try {
    const response = await fetch(`${BASE_URL}/events/send`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(event),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      log.error({ status: response.status, body }, 'Loops event send failed');
      return { success: false };
    }

    const result = await response.json() as { success: boolean };
    return result;
  } catch (err) {
    log.error({ err: String(err) }, 'Loops event send error');
    return { success: false };
  }
}

export async function deleteContact(email: string): Promise<{ success: boolean }> {
  try {
    const response = await fetch(`${BASE_URL}/contacts/delete`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ email }),
    });

    if (!response.ok) {
      log.error({ status: response.status, email }, 'Loops contact delete failed');
      return { success: false };
    }

    return { success: true };
  } catch (err) {
    log.error({ err: String(err), email }, 'Loops contact delete error');
    return { success: false };
  }
}

export async function findContact(emailOrUserId: string): Promise<LoopsContact | null> {
  try {
    const isEmail = emailOrUserId.includes('@');
    const param = isEmail ? `email=${encodeURIComponent(emailOrUserId)}` : `userId=${encodeURIComponent(emailOrUserId)}`;
    const response = await fetch(`${BASE_URL}/contacts/find?${param}`, {
      method: 'GET',
      headers: getHeaders(),
    });

    if (!response.ok) {
      if (response.status === 404) return null;
      log.error({ status: response.status }, 'Loops find contact failed');
      return null;
    }

    const result = await response.json() as LoopsContact;
    return result;
  } catch (err) {
    log.error({ err: String(err) }, 'Loops find contact error');
    return null;
  }
}
