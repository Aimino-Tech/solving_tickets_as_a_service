import { describe, expect, it } from 'vitest';
import { validateTemplateYaml, dryRunResolve, preflightValidate } from '../../template/validator.js';
import { validatePlaceholders, suggestPlaceholder } from '../../template/placeholderRegistry.js';

describe('validateTemplateYaml', () => {
  it('passes a valid template with all required phases', () => {
    const template = {
      phases: {
        pre: [{ command: 'opencode plan --issue {issue.number}', session: 'new' }],
        main: [{ command: 'opencode agent --full-cycle', session: 'new' }],
        post: [{ command: 'opencode remove-anti-slop', session: 'new' }],
        final: [{ command: 'opencode create-pr', session: 'new' }],
      },
    };

    const result = validateTemplateYaml(template);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects a template without phases', () => {
    const result = validateTemplateYaml({});
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].field).toBe('phases');
  });

  it('rejects a non-object template', () => {
    const result = validateTemplateYaml('not-an-object');
    expect(result.valid).toBe(false);
  });

  it('rejects a template with empty phases', () => {
    const template = { phases: {} };
    const result = validateTemplateYaml(template);
    expect(result.valid).toBe(false);
  });

  it('rejects unknown placeholders with suggestion', () => {
    const template = {
      phases: {
        main: [{ command: 'opencode --issue {issue.nmbr}', session: 'new' }],
      },
    };

    const result = validateTemplateYaml(template);
    expect(result.valid).toBe(false);
    expect(result.errors[0].type).toBe('placeholder');
    expect(result.errors[0].message).toContain('did you mean');
    expect(result.errors[0].message).toContain('issue.number');
  });

  it('warns about unknown session mode', () => {
    const template = {
      phases: {
        main: [{ command: 'opencode run', session: 'parallel' }],
      },
    };

    const result = validateTemplateYaml(template);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0].message).toContain('session mode');
  });

  it('allows missing optional session field', () => {
    const template = {
      phases: {
        main: [{ command: 'opencode run' }],
      },
    };

    const result = validateTemplateYaml(template);
    expect(result.valid).toBe(true);
  });
});

describe('dryRunResolve', () => {
  it('resolves placeholders with context values', () => {
    const template = {
      phases: {
        pre: [{ command: 'opencode --issue {issue.number} --repo {repo.name}', session: 'new' }],
      },
    };

    const resolved = dryRunResolve(template, { 'issue.number': 42, 'repo.name': 'test-repo' });
    expect(resolved).toHaveLength(1);
    expect(resolved[0].resolved).toBe('opencode --issue 42 --repo test-repo');
  });

  it('leaves unresolved placeholders as-is', () => {
    const template = {
      phases: {
        pre: [{ command: 'opencode --issue {issue.number}', session: 'new' }],
      },
    };

    const resolved = dryRunResolve(template, {});
    expect(resolved[0].resolved).toBe('opencode --issue {issue.number}');
  });
});

describe('preflightValidate', () => {
  it('passes fully resolved commands', () => {
    const result = preflightValidate(['opencode plan', 'opencode run']);
    expect(result.valid).toBe(true);
  });

  it('rejects command with unresolved placeholders', () => {
    const result = preflightValidate(['opencode --issue {issue.number}']);
    expect(result.valid).toBe(false);
    expect(result.errors[0].type).toBe('placeholder');
  });

  it('rejects empty command', () => {
    const result = preflightValidate(['']);
    expect(result.valid).toBe(false);
    expect(result.errors[0].type).toBe('command');
  });
});

describe('validatePlaceholders', () => {
  it('identifies known placeholders', () => {
    const result = validatePlaceholders('opencode --issue {issue.number} --repo {repo.name}');
    expect(result.valid).toEqual(['issue.number', 'repo.name']);
    expect(result.unknown).toHaveLength(0);
  });

  it('flags unknown placeholders', () => {
    const result = validatePlaceholders('opencode --issue {issue.nmbr}');
    expect(result.unknown).toEqual(['issue.nmbr']);
  });

  it('provides suggestions for typos', () => {
    const result = validatePlaceholders('opencode --issue {issuenumber}');
    expect(result.suggestions.length).toBeGreaterThan(0);
  });
});

describe('suggestPlaceholder', () => {
  it('suggests close matches', () => {
    const result = suggestPlaceholder('issue.nmbr');
    expect(result).not.toBeNull();
    expect(result?.suggestion).toBe('issue.number');
  });

  it('returns null for completely different strings', () => {
    const result = suggestPlaceholder('completely.wrong');
    expect(result).toBeNull();
  });
});
