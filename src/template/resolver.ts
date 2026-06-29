import { rootLogger } from '../utils/logger.js';
import type { LoadedTemplate } from './loader.js';
import { getLoadedTemplate, listLoadedTemplates } from './loader.js';

const log = rootLogger.child({ module: 'template-resolver' });

export interface TemplateMatch {
  template: LoadedTemplate;
  matchStrategy: 'exact' | 'prefix' | 'type_inference' | 'fallback';
  confidence: number;
}

export interface ClassificationResult {
  type: string;
  label: string;
  confidence: number;
}

const REQUEST_TYPE_LABELS: Record<string, string[]> = {
  bug: ['stas:fix', 'stas:bugfix', 'stas:bug', 'bug'],
  feature: ['stas:feature', 'stas:feat', 'enhancement', 'feature'],
  planning: ['stas:plan', 'stas:planning', 'plan', 'design'],
  research: ['stas:research', 'stas:explore', 'research', 'question'],
  documentation: ['stas:docs', 'documentation', 'docs'],
};

export function classifyByLabel(labels: string[]): ClassificationResult {
  for (const label of labels) {
    const lower = label.toLowerCase();

    if (lower.startsWith('stas:')) {
      const typePart = lower.replace('stas:', '');
      if (typePart.startsWith('fix') || typePart.startsWith('bug')) {
        return { type: 'bug', label, confidence: 0.95 };
      }
      if (typePart.startsWith('feat') || typePart === 'feature') {
        return { type: 'feature', label, confidence: 0.95 };
      }
      if (typePart.startsWith('plan')) {
        return { type: 'planning', label, confidence: 0.95 };
      }
      if (typePart.startsWith('research') || typePart.startsWith('explore')) {
        return { type: 'research', label, confidence: 0.95 };
      }
      if (typePart.startsWith('doc')) {
        return { type: 'documentation', label, confidence: 0.95 };
      }
    }

    for (const [requestType, matchingLabels] of Object.entries(REQUEST_TYPE_LABELS)) {
      if (matchingLabels.includes(lower)) {
        return { type: requestType, label, confidence: 0.85 };
      }
    }
  }

  return { type: 'unknown', label: 'unknown', confidence: 0.4 };
}

export function resolveTemplate(
  classification: ClassificationResult,
  labels: string[],
): TemplateMatch {
  const templates = listLoadedTemplates();
  if (templates.length === 0) {
    log.warn('No templates loaded — returning fallback');
    return createFallbackMatch(classification, labels);
  }

  const exactMatch = findExactLabelMatch(labels, templates);
  if (exactMatch) {
    log.info({ template: exactMatch.template.name, strategy: 'exact' }, 'Template resolved by exact label match');
    return { template: exactMatch.template, matchStrategy: 'exact', confidence: 1.0 };
  }

  const prefixMatch = findPrefixLabelMatch(classification, labels, templates);
  if (prefixMatch) {
    log.info({ template: prefixMatch.template.name, strategy: 'prefix' }, 'Template resolved by label prefix');
    return { template: prefixMatch.template, matchStrategy: 'prefix', confidence: 0.9 };
  }

  const typeMatch = findByTypeInference(classification, templates);
  if (typeMatch) {
    log.info({ template: typeMatch.template.name, strategy: 'type_inference' }, 'Template resolved by type inference');
    return { template: typeMatch.template, matchStrategy: 'type_inference', confidence: 0.8 };
  }

  log.info({ strategy: 'fallback' }, 'No template match — using fallback');
  return createFallbackMatch(classification, labels);
}

function findExactLabelMatch(
  labels: string[],
  templates: LoadedTemplate[],
): { template: LoadedTemplate } | null {
  for (const label of labels) {
    const lowerLabel = label.toLowerCase();
    for (const tpl of templates) {
      for (const tplLabel of tpl.labels) {
        if (tplLabel.toLowerCase() === lowerLabel) {
          return { template: tpl };
        }
      }
    }
  }
  return null;
}

function findPrefixLabelMatch(
  _classification: ClassificationResult,
  labels: string[],
  templates: LoadedTemplate[],
): { template: LoadedTemplate } | null {
  for (const label of labels) {
    for (const tpl of templates) {
      for (const tplLabel of tpl.labels) {
        if (label.toLowerCase().startsWith(tplLabel.toLowerCase() + ':') ||
            label.toLowerCase().startsWith(tplLabel.toLowerCase())) {
          return { template: tpl };
        }
      }
    }
  }
  return null;
}

function findByTypeInference(
  classification: ClassificationResult,
  templates: LoadedTemplate[],
): { template: LoadedTemplate } | null {
  for (const tpl of templates) {
    for (const tplLabel of tpl.labels) {
      if (tplLabel.toLowerCase().includes(classification.type)) {
        return { template: tpl };
      }
    }
  }
  return null;
}

function createFallbackMatch(
  _classification: ClassificationResult,
  _labels: string[],
): TemplateMatch {
  const fallback = getLoadedTemplate('default');
  if (fallback) {
    return { template: fallback, matchStrategy: 'fallback', confidence: 0.5 };
  }

  return {
    template: {
      name: 'default',
      labels: ['default'],
      phases: {
        pre: [{ command: 'echo "No template configured"', session: 'new' }],
        main: [{ command: 'echo "No template configured"', session: 'new' }],
        post: [{ command: 'echo "No template configured"', session: 'new' }],
        final: [{ command: 'echo "No template configured"', session: 'new' }],
      },
    },
    matchStrategy: 'fallback',
    confidence: 0.3,
  };
}
