import { beforeEach, describe, expect, it } from 'vitest';
import { registerDefaultTemplates } from '../../template/defaultTemplates.js';
import { templateRegistry } from '../../template/templateRegistry.js';
import type { TemplateDefinition } from '../../template/types.js';

describe('templateRegistry', () => {
  beforeEach(() => {
    templateRegistry.clear();
  });

  it('registers and retrieves a template', () => {
    const def: TemplateDefinition = {
      id: 'test-template',
      name: 'Test Template',
      description: 'A test template',
      version: '1.0.0',
      variables: [{ name: 'repo', description: 'Repository name', required: true }],
      render: async (data) => `Processing ${data.repo}`,
    };

    templateRegistry.register(def);
    expect(templateRegistry.get('test-template')).toBeDefined();
    expect(templateRegistry.get('test-template')?.name).toBe('Test Template');
  });

  it('lists all registered templates', () => {
    const def1: TemplateDefinition = {
      id: 't1',
      name: 'T1',
      description: '',
      version: '1.0.0',
      variables: [],
      render: async () => '',
    };
    const def2: TemplateDefinition = {
      id: 't2',
      name: 'T2',
      description: '',
      version: '1.0.0',
      variables: [],
      render: async () => '',
    };
    templateRegistry.register(def1);
    templateRegistry.register(def2);

    const list = templateRegistry.list();
    expect(list).toHaveLength(2);
  });

  it('renders a template with data', async () => {
    const def: TemplateDefinition = {
      id: 'render-test',
      name: 'Render Test',
      description: '',
      version: '1.0.0',
      variables: [{ name: 'repo', description: '', required: true }],
      render: async (data) => `Repo: ${data.repo}`,
    };

    templateRegistry.register(def);
    const result = await templateRegistry.render('render-test', { repo: 'test/repo' }, {} as any);
    expect(result).toBe('Repo: test/repo');
  });

  it('unregisters a template', () => {
    const def: TemplateDefinition = {
      id: 'remove-me',
      name: 'Remove',
      description: '',
      version: '1.0.0',
      variables: [],
      render: async () => '',
    };
    templateRegistry.register(def);
    expect(templateRegistry.get('remove-me')).toBeDefined();

    templateRegistry.unregister('remove-me');
    expect(templateRegistry.get('remove-me')).toBeUndefined();
  });

  it('throws on rendering unknown template', async () => {
    await expect(templateRegistry.render('nonexistent', {}, {} as any)).rejects.toThrow(
      'Template not found: nonexistent',
    );
  });
});

describe('registerDefaultTemplates', () => {
  beforeEach(() => {
    templateRegistry.clear();
  });

  it('registers default job templates', () => {
    registerDefaultTemplates();
    const jobTemplates = templateRegistry.listJobTemplates();
    expect(jobTemplates.length).toBeGreaterThan(0);

    const fixTemplate = templateRegistry.getJobTemplate('issue-fix');
    expect(fixTemplate).toBeDefined();
    expect(fixTemplate?.queueName).toBe('syntaro.issues.fix');
    expect(fixTemplate?.exchangeName).toBe('syntaro.direct');
    expect(fixTemplate?.routingKey).toBe('issue.fix');
    expect(fixTemplate?.retryConfig.maxRetries).toBe(4);
  });

  it('registers all expected template types', () => {
    registerDefaultTemplates();
    const expectedIds = [
      'issue-fix',
      'issue-feature',
      'issue-research',
      'webhook-notification',
      'analytics-ingestion',
      'pipeline-event',
    ];
    for (const id of expectedIds) {
      expect(templateRegistry.getJobTemplate(id)).toBeDefined();
    }
  });
});
