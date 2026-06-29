import { describe, it, expect } from 'vitest';
import { validateTemplateYaml, templateSchema, stepSchema } from '../../template/validator.js';

describe('TemplateValidator', () => {
  const validTemplate = {
    name: 'stas:fix',
    labels: ['stas:fix', 'stas:bugfix'],
    phases: {
      pre: [{ name: 'plan', command: 'opencode plan --issue {issue.number}', session: 'new' }],
      main: [{ name: 'fix', command: 'opencode agent --full-cycle', session: 'new' }],
      post: [{ name: 'verify', command: 'opencode run-ci', session: 'new' }],
      final: [{ name: 'create-pr', command: 'opencode agent --mode create-pr', session: 'new' }],
    },
  };

  it('validates a correct template', () => {
    const result = validateTemplateYaml(validTemplate);
    expect(result.name).toBe('stas:fix');
    expect(result.labels).toEqual(['stas:fix', 'stas:bugfix']);
    expect(Object.keys(result.phases)).toEqual(['pre', 'main', 'post', 'final']);
  });

  it('rejects template without name', () => {
    expect(() => validateTemplateYaml({ ...validTemplate, name: '' })).toThrow();
  });

  it('rejects template without labels', () => {
    expect(() => validateTemplateYaml({ ...validTemplate, labels: [] })).toThrow();
  });

  it('rejects template without phases', () => {
    expect(() => validateTemplateYaml({ ...validTemplate, phases: {} })).toThrow();
  });

  it('rejects template with empty phase', () => {
    expect(() => validateTemplateYaml({ ...validTemplate, phases: { pre: [] } })).toThrow();
  });

  it('applies defaults for optional fields', () => {
    const minimal = {
      name: 'test',
      labels: ['test'],
      phases: { main: [{ name: 'step', command: 'echo hello' }] },
    };
    const result = validateTemplateYaml(minimal);
    expect(result.sessionMode).toBe('new');
    expect(result.phases.main[0].session).toBe('new');
  });

  it('validates step schema correctly', () => {
    const valid = stepSchema.parse({ name: 'test', command: 'echo hi' });
    expect(valid.name).toBe('test');
    expect(valid.command).toBe('echo hi');
    expect(valid.session).toBe('new');
  });
});
