import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';
import { rootLogger } from '../utils/logger.js';
import { validateTemplateYaml } from './validator.js';
import { templateRegistry } from './templateRegistry.js';
import type { JobTemplate } from './types.js';

const log = rootLogger.child({ module: 'template-loader' });

const DEFAULT_RETRY_DELAYS = [30_000, 120_000, 300_000, 900_000];

export interface LoadedTemplate {
  name: string;
  labels: string[];
  phases: Record<string, { command: string; session: string }[]>;
}

const loadedTemplates: Map<string, LoadedTemplate> = new Map();

export function scanTemplatesDirectory(basePath?: string): LoadedTemplate[] {
  const templatesDir = resolve(basePath ?? process.cwd(), '.stas/templates');
  const results: LoadedTemplate[] = [];

  if (!existsSync(templatesDir)) {
    log.warn({ path: templatesDir }, 'Templates directory not found');
    return results;
  }

  let entries: string[];
  try {
    entries = readdirSync(templatesDir);
  } catch (err) {
    log.error({ err: String(err), path: templatesDir }, 'Failed to read templates directory');
    return results;
  }

  for (const entry of entries) {
    if (!entry.endsWith('.yaml') && !entry.endsWith('.yml')) continue;

    const filePath = join(templatesDir, entry);
    try {
      const raw = readFileSync(filePath, 'utf-8');
      const parsed = yaml.load(raw);

      const validation = validateTemplateYaml(parsed);
      if (!validation.valid) {
        log.warn(
          { file: entry, errors: validation.errors.map((e) => e.message) },
          'Skipping invalid template YAML',
        );
        continue;
      }

      const template = parsed as Record<string, unknown>;
      const name = (template.name as string) ?? entry.replace(/\.(yaml|yml)$/, '');
      const labels = (template.labels as string[]) ?? [name];

      const loaded: LoadedTemplate = {
        name,
        labels,
        phases: template.phases as Record<string, { command: string; session: string }[]>,
      };

      loadedTemplates.set(name, loaded);
      results.push(loaded);

      log.info({ name, labels, phases: Object.keys(loaded.phases) }, 'Loaded template');
    } catch (err) {
      log.warn({ file: entry, err: String(err) }, 'Failed to load template YAML');
    }
  }

  return results;
}

export function getLoadedTemplate(name: string): LoadedTemplate | undefined {
  return loadedTemplates.get(name);
}

export function listLoadedTemplates(): LoadedTemplate[] {
  return [...loadedTemplates.values()];
}

export function clearLoadedTemplates(): void {
  loadedTemplates.clear();
}

export function buildJobTemplateFromLoaded(template: LoadedTemplate): JobTemplate {
  return {
    templateId: template.name,
    queueName: `stas.${template.name}`,
    exchangeName: 'stas.direct',
    routingKey: `stas.job.${template.name}`,
    priority: 5,
    retryConfig: {
      maxRetries: 4,
      retryDelaysMs: DEFAULT_RETRY_DELAYS,
      deadLetterExchange: 'stas.dlx',
    },
    ttl: 600_000,
    dedupTtl: 120,
  };
}

export function loadAndRegisterTemplates(basePath?: string): void {
  const loaded = scanTemplatesDirectory(basePath);
  for (const tpl of loaded) {
    const jobTemplate = buildJobTemplateFromLoaded(tpl);
    templateRegistry.registerJobTemplate(jobTemplate);
  }
  log.info({ count: loaded.length }, 'Templates loaded and registered');
}

export function getResolvedCommand(
  templateName: string,
  phase: string,
  stepIndex: number,
  context: Record<string, string | number>,
): string | null {
  const template = loadedTemplates.get(templateName);
  if (!template) return null;

  const phaseSteps = template.phases[phase];
  if (!phaseSteps || stepIndex >= phaseSteps.length) return null;

  const command = phaseSteps[stepIndex].command;
  return command.replace(/\{([^}]+)\}/g, (_match, name: string) => {
    return String(context[name] ?? `{${name}}`);
  });
}
