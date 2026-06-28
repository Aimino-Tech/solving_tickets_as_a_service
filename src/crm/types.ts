export interface LoopsContact {
  email: string;
  userId?: string;
  firstName?: string;
  lastName?: string;
  source?: string;
  mailingLists?: Record<string, boolean>;
  [key: string]: unknown;
}

export interface LoopsEvent {
  email?: string;
  userId?: string;
  eventName: string;
  mailingLists?: Record<string, boolean>;
  [key: string]: unknown;
}

export interface LoopsWebhookPayload {
  eventName: string;
  webhookSchemaVersion: string;
  contact: LoopsContact;
  contactIdentity: {
    email?: string;
    userId?: string;
  };
  email?: {
    id: string;
    subject?: string;
    from?: string;
    to?: string;
    sentAt?: string;
  };
  loopId?: string;
  loopName?: string;
}

export interface CrmSyncJobData {
  type: 'sync-contacts' | 'sync-events' | 'sync-contact-update' | 'webhook-process';
  contact?: LoopsContact;
  event?: LoopsEvent;
  webhookPayload?: LoopsWebhookPayload;
  timestamp: string;
}

export interface CrmSyncResult {
  status: 'completed' | 'partial' | 'failed';
  recordsProcessed: number;
  recordsFailed: number;
  errors?: string[];
  timestamp: string;
}
