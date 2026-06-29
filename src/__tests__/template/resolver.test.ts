import { describe, it, expect, vi } from 'vitest';
import { classifyRequestType, resolveTemplate } from '../../template/resolver.js';
import { TemplateLoader } from '../../template/loader.js';
import type { TemplateConfig } from '../../template/types.js';

describe('Classifier', () => {
  it('classifies stas:fix as coding with high confidence', () => {
    const result = classifyRequestType(['stas:fix']);
    expect(result.type).toBe('coding');
    expect(result.confidence).toBe(0.95);
  });

  it('classifies stas:plan as planning', () => {
    const result = classifyRequestType(['stas:plan']);
    expect(result.type).toBe('planning');
  });

  it('classifies stas:research as open-ended', () => {
    const result = classifyRequestType(['stas:research']);
    expect(result.type).toBe('open-ended');
  });

  it('classifies bug keyword in body', () => {
    const result = classifyRequestType([], 'This is a bug report');
    expect(result.type).toBe('bug');
    expect(result.confidence).toBe(0.85);
  });

  it('falls back to default for unknown labels', () => {
    const result = classifyRequestType(['random-label']);
    expect(result.type).toBe('coding');
    expect(result.confidence).toBe(0.5);
  });

  it('prefers explicit label over body text', () => {
    const result = classifyRequestType(['stas:plan'], 'bug report');
    expect(result.type).toBe('planning');
  });
});

describe('TemplateResolver', () => {
  const fixTemplate: TemplateConfig = {
    name: 'stas:fix',
    labels: ['stas:fix'],
    phases: { main: [{ name: 'fix', command: 'opencode agent', session: 'new' }] },
  };

  const defaultTemplate: TemplateConfig = {
    name: 'default',
    labels: ['stas:fix'],
    phases: { main: [{ name: 'default', command: 'echo default', session: 'new' }] },
  };

  it('resolves by exact label match', async () => {
    const loader = new TemplateLoader();
    vi.spyOn(loader, 'getTemplate').mockImplementation(async (name: string) => {
      if (name === 'stas:fix') return fixTemplate;
      return null;
    });

    const result = await resolveTemplate(loader, ['stas:fix']);
    expect(result.template.name).toBe('stas:fix');
    expect(result.classification.type).toBe('coding');
  });

  it('falls back to classified label when no exact match', async () => {
    const loader = new TemplateLoader();
    vi.spyOn(loader, 'getTemplate').mockImplementation(async (name: string) => {
      if (name === 'stas:fix') return fixTemplate;
      if (name === 'default') return defaultTemplate;
      return null;
    });

    const result = await resolveTemplate(loader, ['unknown-label']);
    expect(result.template.name).toBe('stas:fix');
  });

  it('falls back to default template', async () => {
    const loader = new TemplateLoader();
    vi.spyOn(loader, 'getTemplate').mockImplementation(async (name: string) => {
      if (name === 'default') return defaultTemplate;
      return null;
    });

    const result = await resolveTemplate(loader, ['unknown']);
    expect(result.template.name).toBe('default');
  });
});
