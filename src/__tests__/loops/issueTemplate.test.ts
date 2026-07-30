import { describe, expect, it } from 'vitest';
import { buildTicketDescription } from '../../loops/issueTemplate.js';

describe('buildTicketDescription', () => {
  const fullData = {
    input: 'User cannot login with GitHub OAuth',
    output: 'A PR that fixes the GitHub OAuth flow',
    context: {
      what: 'GitHub OAuth login fails with 401',
      how: 'User clicks "Login with GitHub", gets redirected, but callback returns 401',
      where: 'src/auth/github.ts:45',
      when: 'After deploying v2.1.0',
      result: 'GitHub OAuth login should complete successfully',
    },
    suggestedImplementation: 'Check the callback URL matches GitHub App settings',
    acceptanceCriteria: [
      'GitHub OAuth login works end-to-end',
      'Error is logged if callback fails',
    ],
  };

  it('generates correct markdown with full fields', () => {
    const result = buildTicketDescription(fullData);

    expect(result).toContain('## Input');
    expect(result).toContain('User cannot login with GitHub OAuth');

    expect(result).toContain('## Output');
    expect(result).toContain('A PR that fixes the GitHub OAuth flow');

    expect(result).toContain('## Context');
    expect(result).toContain('- What: GitHub OAuth login fails with 401');
    expect(result).toContain('- How: User clicks "Login with GitHub", gets redirected, but callback returns 401');
    expect(result).toContain('- Where: src/auth/github.ts:45');
    expect(result).toContain('- When: After deploying v2.1.0');
    expect(result).toContain('- Result: GitHub OAuth login should complete successfully');

    expect(result).toContain('## Suggested Implementation');
    expect(result).toContain('Check the callback URL matches GitHub App settings');

    expect(result).toContain('## Acceptance Criteria');
    expect(result).toContain('- [ ] GitHub OAuth login works end-to-end');
    expect(result).toContain('- [ ] Error is logged if callback fails');
  });

  it('handles empty fields gracefully', () => {
    const emptyData = {
      input: '',
      output: '',
      context: { what: '', how: '', where: '', when: '', result: '' },
      suggestedImplementation: undefined,
      acceptanceCriteria: [],
    };

    const result = buildTicketDescription(emptyData);

    expect(result).toContain('## Input');
    expect(result).toContain('N/A');
    expect(result).toContain('- What: N/A');
    expect(result).toContain('- How: N/A');
    expect(result).toContain('- Where: N/A');
    expect(result).toContain('- When: N/A');
    expect(result).toContain('- Result: N/A');
    expect(result).toContain('## Acceptance Criteria');
    expect(result).toContain('- [ ] Error is resolved');
    expect(result).toContain('- [ ] No regression in related area');
  });

  it('handles partial fields without crashing', () => {
    const partialData = {
      input: 'Something broke',
      output: '',
      context: { what: 'Bug report', how: '', where: '', when: '', result: '' },
      acceptanceCriteria: ['Fix the bug'],
    };

    const result = buildTicketDescription(partialData);

    expect(result).toContain('Something broke');
    expect(result).toContain('N/A');
    expect(result).toContain('- [ ] Fix the bug');
  });

  it('handles null/undefined suggestedImplementation', () => {
    const data = {
      input: 'test',
      output: 'test',
      context: { what: 'a', how: 'b', where: 'c', when: 'd', result: 'e' },
      acceptanceCriteria: ['test'],
    };

    const result = buildTicketDescription(data);

    expect(result).toContain('TBD');
  });

  it('returns a non-empty string', () => {
    const data = {
      input: 'x',
      output: 'y',
      context: { what: 'a', how: 'b', where: 'c', when: 'd', result: 'e' },
      acceptanceCriteria: ['z'],
    };

    const result = buildTicketDescription(data);

    expect(result.length).toBeGreaterThan(0);
    expect(typeof result).toBe('string');
  });
});
