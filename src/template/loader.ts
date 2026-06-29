import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { parse as parseYaml } from 'yaml';
import { Redis } from 'ioredis';
import { rootLogger } from '../utils/logger.js';
import { validateTemplateYaml, TemplateValidationError } from './validator.js';
import type { TemplateConfig, StepConfig } from './types.js';

const log = rootLogger.child({ module: 'template-loader' });

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_PREFIX = 'stas:template:';
const DEFAULT_TEMPLATE_DIR = '.stas/templates';

export class TemplateLoader {
  private templates: Map<string, TemplateConfig> = new Map();
  private lastLoad: number = 0;
  private redis: Redis | null = null;
  private templateDir: string;

  constructor(templateDir?: string, redis?: Redis) {
    this.templateDir = templateDir || DEFAULT_TEMPLATE_DIR;
    this.redis = redis;
  }

  async loadAll(): Promise<Map<string, TemplateConfig>> {
    const results = new Map<string, TemplateConfig>();
    let baseDir: string;

    try {
      const cwd = process.cwd();
      baseDir = join(cwd, this.templateDir);
      const files = await readdir(baseDir);

      for (const file of files) {
        if (file.endsWith('.yaml') || file.endsWith('.yml')) {
          try {
            const config = await this.loadFile(join(baseDir, file));
            if (config) {
              results.set(config.name, config);
            }
          } catch (err) {
            log.warn({ err: String(err), file }, 'Failed to load template file');
          }
        }
      }
    } catch (err) {
      log.warn({ err: String(err) }, 'Template directory not found, using defaults');
    }

    if (results.size === 0) {
      log.info('No templates found, using bundled default');
      const defaults = this.loadDefaults();
      for (const [name, config] of defaults) {
        results.set(name, config);
      }
    }

    this.templates = results;
    this.lastLoad = Date.now();
    await this.cacheTemplates(results);

    return results;
  }

  async getTemplate(name: string): Promise<TemplateConfig | null> {
    if (Date.now() - this.lastLoad > CACHE_TTL_MS) {
      await this.loadAll();
    }
    return this.templates.get(name) ?? null;
  }

  private async loadFile(filePath: string): Promise<TemplateConfig | null> {
    const content = await readFile(filePath, 'utf-8');
    const parsed = parseYaml(content);

    try {
      const validated = validateTemplateYaml(parsed);
      const phases: Record<string, StepConfig[]> = {};

      for (const [phaseName, steps] of Object.entries(validated.phases)) {
        phases[phaseName] = steps.map((s) => ({
          name: s.name,
          command: s.command,
          session: s.session,
          retry: s.retry,
        }));
      }

      return {
        name: validated.name,
        labels: validated.labels,
        phases,
        sessionMode: validated.sessionMode,
        retry: validated.retry,
      };
    } catch (err) {
      if (err instanceof TemplateValidationError) {
        throw err;
      }
      if (err instanceof z.ZodError) {
        throw new TemplateValidationError('Template validation failed', err.issues);
      }
      throw new TemplateValidationError(
        `Failed to parse template: ${String(err)}`,
        [],
      );
    }
  }

  private loadDefaults(): Map<string, TemplateConfig> {
    const defaults = new Map<string, TemplateConfig>();

    defaults.set('default', {
      name: 'default',
      labels: ['stas:fix'],
      phases: {
        pre: [
          { name: 'plan', command: 'opencode plan --issue {issue.number}', session: 'new' },
        ],
        main: [
          { name: 'execute', command: 'opencode agent --full-cycle --issue {issue.number}', session: 'new' },
        ],
        post: [
          { name: 'verify', command: 'opencode run-ci --verify', session: 'new' },
        ],
        final: [
          { name: 'create-pr', command: 'opencode agent --mode create-pr', session: 'new' },
        ],
      },
    });

    return defaults;
  }

  private async cacheTemplates(templates: Map<string, TemplateConfig>): Promise<void> {
    if (!this.redis) return;

    for (const [name, config] of templates) {
      try {
        await this.redis.set(
          `${CACHE_PREFIX}${name}`,
          JSON.stringify(config),
          'PX',
          CACHE_TTL_MS,
        );
      } catch (err) {
        log.warn({ err: String(err), template: name }, 'Failed to cache template');
      }
    }
  }

  async getCachedTemplate(name: string): Promise<TemplateConfig | null> {
    if (!this.redis) return this.getTemplate(name);

    try {
      const cached = await this.redis.get(`${CACHE_PREFIX}${name}`);
      if (cached) {
        return JSON.parse(cached) as TemplateConfig;
      }
    } catch {
      // fall through to file load
    }

    return this.getTemplate(name);
  }
}
