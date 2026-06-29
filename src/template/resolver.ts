import { rootLogger } from '../utils/logger.js';
import type { TemplateConfig } from './types.js';
import { TemplateLoader } from './loader.js';

const log = rootLogger.child({ module: 'template-resolver' });

export type RequestType = 'coding' | 'planning' | 'bug' | 'open-ended';

const LABEL_TO_REQUEST_TYPE: Record<string, RequestType> = {
  'stas:fix': 'coding',
  'stas:bugfix': 'coding',
  'stas:plan': 'planning',
  'stas:research': 'open-ended',
};

const REQUEST_TYPE_TO_LABEL: Record<RequestType, string> = {
  coding: 'stas:fix',
  planning: 'stas:plan',
  bug: 'stas:fix',
  'open-ended': 'stas:research',
};

export function classifyRequestType(labels: string[], issueBody?: string | null): { type: RequestType; label: string; confidence: number } {
  for (const label of labels) {
    const rt = LABEL_TO_REQUEST_TYPE[label];
    if (rt) {
      return { type: rt, label, confidence: 0.95 };
    }
  }

  if (issueBody && /bug|error|crash|broken|fails|failure/i.test(issueBody)) {
    return { type: 'bug', label: 'stas:fix', confidence: 0.85 };
  }

  return { type: 'coding', label: 'stas:fix', confidence: 0.5 };
}

export async function resolveTemplate(
  loader: TemplateLoader,
  labels: string[],
  issueBody?: string | null,
): Promise<{ template: TemplateConfig; classification: { type: RequestType; label: string; confidence: number } }> {
  const classification = classifyRequestType(labels, issueBody);

  // Exact label match
  for (const label of labels) {
    const template = await loader.getTemplate(label);
    if (template) {
      log.info({ template: template.name, label }, 'Resolved template by exact label match');
      return { template, classification };
    }
  }

  // Try classification-based label
  const classifiedLabel = REQUEST_TYPE_TO_LABEL[classification.type];
  if (classifiedLabel) {
    const template = await loader.getTemplate(classifiedLabel);
    if (template) {
      log.info({ template: template.name, label: classifiedLabel }, 'Resolved template by classified label');
      return { template, classification };
    }
  }

  // Fallback to default
  const defaultTemplate = await loader.getTemplate('default');
  if (defaultTemplate) {
    log.info({ template: defaultTemplate.name }, 'Resolved template by default fallback');
    return { template: defaultTemplate, classification };
  }

  // Load all and pick first available
  const allTemplates = await loader.loadAll();
  if (allTemplates.size > 0) {
    const first = allTemplates.values().next().value;
    log.info({ template: first.name }, 'Resolved template by first available');
    return { template: first, classification };
  }

  throw new Error('No templates available');
}
