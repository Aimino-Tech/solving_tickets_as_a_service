import { rootLogger } from '../utils/logger.js';
import type { TemplateDefinition, TemplateRegistryEntry, JobTemplate } from './types.js';

const log = rootLogger.child({ module: 'template-registry' });

class TemplateRegistry {
  private templates: Map<string, TemplateRegistryEntry> = new Map();
  private jobTemplates: Map<string, JobTemplate> = new Map();

  register(definition: TemplateDefinition): void {
    const now = new Date().toISOString();
    const existing = this.templates.get(definition.id);
    this.templates.set(definition.id, {
      definition,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    log.info({ templateId: definition.id, name: definition.name }, 'Template registered');
  }

  get(id: string): TemplateDefinition | undefined {
    return this.templates.get(id)?.definition;
  }

  list(): TemplateDefinition[] {
    return [...this.templates.values()].map((e) => e.definition);
  }

  unregister(id: string): boolean {
    const removed = this.templates.delete(id);
    this.jobTemplates.delete(id);
    if (removed) log.info({ templateId: id }, 'Template unregistered');
    return removed;
  }

  registerJobTemplate(jobTemplate: JobTemplate): void {
    this.jobTemplates.set(jobTemplate.templateId, jobTemplate);
    log.info(
      { templateId: jobTemplate.templateId, queueName: jobTemplate.queueName },
      'Job template registered',
    );
  }

  getJobTemplate(id: string): JobTemplate | undefined {
    return this.jobTemplates.get(id);
  }

  listJobTemplates(): JobTemplate[] {
    return [...this.jobTemplates.values()];
  }

  async render(templateId: string, data: Record<string, unknown>, context: Parameters<TemplateDefinition['render']>[1]): Promise<string> {
    const def = this.get(templateId);
    if (!def) throw new Error(`Template not found: ${templateId}`);
    return def.render(data, context);
  }

  clear(): void {
    this.templates.clear();
    this.jobTemplates.clear();
    log.info('Template registry cleared');
  }
}

export const templateRegistry = new TemplateRegistry();
