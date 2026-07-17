import type { IssueJobData } from '../utils/types.js';

export interface TemplateVariable {
  name: string;
  description: string;
  required: boolean;
  defaultValue?: string;
}

export interface TemplateDefinition {
  id: string;
  name: string;
  description: string;
  version: string;
  variables: TemplateVariable[];
  render(data: Record<string, unknown>, context: IssueJobData): Promise<string>;
}

export interface TemplateRegistryEntry {
  definition: TemplateDefinition;
  createdAt: string;
  updatedAt: string;
}

export interface JobTemplate {
  templateId: string;
  queueName: string;
  exchangeName: string;
  routingKey: string;
  priority: number;
  retryConfig: {
    maxRetries: number;
    retryDelaysMs: number[];
    deadLetterExchange: string;
  };
  ttl: number;
  dedupTtl: number;
}
