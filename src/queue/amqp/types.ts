export interface MessageEnvelope {
  version: number;
  messageId: string;
  timestamp: string;
  source: string;
  type: string;
  correlationId?: string;
  replyTo?: string;
  payload: Record<string, unknown>;
}

export interface JobPayload {
  jobId: string;
  issue: {
    number: number;
    title: string;
    body: string | null;
    labels: string[];
    repo: string;
  };
  template: {
    name: string;
    phases: string[];
  };
  classification: {
    type: string;
    label: string;
    confidence: number;
  };
}

export interface PhasePayload {
  jobId: string;
  phase: string;
  issue: {
    number: number;
    title: string;
    body: string | null;
    labels: string[];
    repo: string;
  };
  template: {
    name: string;
  };
}

export interface RetryMessage {
  originalExchange: string;
  originalRoutingKey: string;
  envelope: MessageEnvelope;
  retryCount: number;
  error: string;
}
