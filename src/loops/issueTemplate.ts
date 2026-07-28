export interface TicketData {
  input: string;
  output: string;
  context: {
    what: string;
    how: string;
    where: string;
    when: string;
    result: string;
  };
  suggestedImplementation?: string;
  acceptanceCriteria: string[];
}

export function buildTicketDescription(data: TicketData): string {
  const sections: string[] = [];

  sections.push('## Input');
  sections.push(data.input || 'N/A');
  sections.push('');

  sections.push('## Output');
  sections.push(data.output || 'N/A');
  sections.push('');

  sections.push('## Context');
  sections.push(`- What: ${data.context.what || 'N/A'}`);
  sections.push(`- How: ${data.context.how || 'N/A'}`);
  sections.push(`- Where: ${data.context.where || 'N/A'}`);
  sections.push(`- When: ${data.context.when || 'N/A'}`);
  sections.push(`- Result: ${data.context.result || 'N/A'}`);
  sections.push('');

  sections.push('## Suggested Implementation');
  sections.push(data.suggestedImplementation || 'TBD — requires investigation');
  sections.push('');

  sections.push('## Acceptance Criteria');
  if (data.acceptanceCriteria.length > 0) {
    for (const criterion of data.acceptanceCriteria) {
      sections.push(`- [ ] ${criterion}`);
    }
  } else {
    sections.push('- [ ] Error is resolved');
    sections.push('- [ ] No regression in related area');
  }

  return sections.join('\n');
}
