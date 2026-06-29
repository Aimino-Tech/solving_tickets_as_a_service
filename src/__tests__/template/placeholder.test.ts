import { describe, it, expect } from 'vitest';
import { replacePlaceholders, extractPlaceholders, resolveCommand } from '../../template/placeholder.js';
import type { StepContext } from '../../template/types.js';

const defaultContext: StepContext = {
  issue: { number: 42, title: 'Fix login race', body: 'When user logs in...', labels: ['stas:fix', 'bug'] },
  repo: { owner: 'tamnguyen08', name: 'solving_tickets_as_a_service' },
  template: { name: 'stas:fix' },
  phase: { name: 'main' },
};

describe('PlaceholderEngine', () => {
  it('replaces {issue.number} with the issue number', () => {
    const result = replacePlaceholders('opencode plan --issue {issue.number}', defaultContext);
    expect(result).toBe('opencode plan --issue 42');
  });

  it('replaces {issue.title} with the issue title', () => {
    const result = replacePlaceholders('grep-memory --query {issue.title}', defaultContext);
    expect(result).toBe('grep-memory --query Fix login race');
  });

  it('replaces {repo.owner} and {repo.name}', () => {
    const result = replacePlaceholders('cd {repo.owner}/{repo.name}', defaultContext);
    expect(result).toBe('cd tamnguyen08/solving_tickets_as_a_service');
  });

  it('replaces {template.name} and {phase.name}', () => {
    const result = replacePlaceholders('Running {template.name} phase {phase.name}', defaultContext);
    expect(result).toBe('Running stas:fix phase main');
  });

  it('leaves unknown placeholders unchanged', () => {
    const result = replacePlaceholders('echo {unknown.placeholder}', defaultContext);
    expect(result).toBe('echo {unknown.placeholder}');
  });

  it('handles multiple placeholders in one command', () => {
    const result = replacePlaceholders(
      'pr: {issue.number} - {issue.title} by {repo.owner}/{repo.name}',
      defaultContext,
    );
    expect(result).toBe('pr: 42 - Fix login race by tamnguyen08/solving_tickets_as_a_service');
  });

  it('extracts placeholders from a command', () => {
    const placeholders = extractPlaceholders('echo {issue.number} {repo.owner}');
    expect(placeholders).toEqual(['issue.number', 'repo.owner']);
  });

  it('deduplicates repeated placeholders', () => {
    const placeholders = extractPlaceholders('{issue.number} + {issue.number}');
    expect(placeholders).toEqual(['issue.number']);
  });

  it('resolves a command into resolved string and placeholder list', () => {
    const result = resolveCommand('opencode agent --issue {issue.number}', defaultContext);
    expect(result.command).toBe('opencode agent --issue 42');
    expect(result.placeholders).toEqual(['issue.number']);
  });

  it('handles commands with no placeholders', () => {
    const result = replacePlaceholders('echo hello world', defaultContext);
    expect(result).toBe('echo hello world');
  });

  it('handles empty command string', () => {
    const result = replacePlaceholders('', defaultContext);
    expect(result).toBe('');
  });
});
