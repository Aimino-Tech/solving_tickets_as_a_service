import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'loops-crm' });

export interface LoopsContact {
  email: string;
  firstName?: string;
  lastName?: string;
  userId?: string;
  source?: string;
  subscribedToEmails?: boolean;
}

export interface LoopsEvent {
  email: string;
  eventName: string;
  userId?: string;
  properties?: Record<string, unknown>;
}

/**
 * Sync a contact to Loops.so CRM.
 */
export async function syncContact(contact: LoopsContact): Promise<boolean> {
  const apiKey = config.loops?.apiKey;
  if (!apiKey) {
    log.warn('LOOPS_API_KEY not configured — skipping contact sync');
    return false;
  }
  try {
    const response = await fetch('https://app.loops.so/api/v1/contacts/create', {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: contact.email,
        firstName: contact.firstName,
        lastName: contact.lastName,
        userId: contact.userId,
        source: contact.source || 'stas',
        subscribedToEmails: contact.subscribedToEmails ?? true,
      }),
    });
    if (!response.ok) {
      log.error({ status: response.status }, 'Loops contact sync failed');
      return false;
    }
    log.info({ email: contact.email }, 'Loops contact synced');
    return true;
  } catch (err) {
    log.error({ err }, 'Loops API error');
    return false;
  }
}

/**
 * Send an event to Loops.so for triggered email campaigns.
 */
export async function sendEvent(event: LoopsEvent): Promise<boolean> {
  const apiKey = config.loops?.apiKey;
  if (!apiKey) return false;
  try {
    await fetch('https://app.loops.so/api/v1/events/send', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: event.email,
        eventName: event.eventName,
        userId: event.userId,
        ...event.properties,
      }),
    });
    return true;
  } catch {
    return false;
  }
}
