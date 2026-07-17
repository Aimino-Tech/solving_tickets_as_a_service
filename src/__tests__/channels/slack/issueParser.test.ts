import { describe, expect, it } from 'vitest';
import { parseIssueRefs } from '../../../channels/slack/issueParser.js';

describe('parseIssueRefs', () => {
  it('parses full GitHub issue URLs', () => {
    const text = 'Check https://github.com/owner/repo/issues/42 please';
    const refs = parseIssueRefs(text);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      owner: 'owner',
      repo: 'repo',
      issueNumber: 42,
    });
  });

  it('parses shorthand org/repo#123 format', () => {
    const text = 'Fix owner/repo#123 asap';
    const refs = parseIssueRefs(text);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      owner: 'owner',
      repo: 'repo',
      issueNumber: 123,
    });
  });

  it('parses bare #123 with defaults', () => {
    const text = 'Please fix #456';
    const refs = parseIssueRefs(text, 'my-org', 'my-repo');
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      owner: 'my-org',
      repo: 'my-repo',
      issueNumber: 456,
    });
  });

  it('returns empty array for bare #123 without defaults', () => {
    const refs = parseIssueRefs('Fix #456');
    expect(refs).toHaveLength(0);
  });

  it('deduplicates the same issue ref', () => {
    const text = 'https://github.com/a/b/issues/1 and a/b#1';
    const refs = parseIssueRefs(text, 'x', 'y');
    expect(refs).toHaveLength(1);
    expect(refs[0].issueNumber).toBe(1);
  });

  it('parses multiple issue references', () => {
    const text = 'Fix owner/repo#1 and also org/other#2 and https://github.com/x/y/issues/3';
    const refs = parseIssueRefs(text);
    expect(refs).toHaveLength(3);
    expect(refs.map((r) => `${r.owner}/${r.repo}#${r.issueNumber}`)).toEqual([
      'x/y#3',
      'owner/repo#1',
      'org/other#2',
    ]);
  });

  it('handles text with no issue references', () => {
    const refs = parseIssueRefs('just a normal message with no refs');
    expect(refs).toHaveLength(0);
  });

  it('parses issue ref in markdown link syntax', () => {
    const text = 'see <https://github.com/org/repo/issues/99|this issue>';
    const refs = parseIssueRefs(text);
    expect(refs).toHaveLength(1);
    expect(refs[0].issueNumber).toBe(99);
  });

  it('strips leading whitespace from short refs', () => {
    const text = 'issues:  org/repo#7';
    const refs = parseIssueRefs(text);
    expect(refs).toHaveLength(1);
    expect(refs[0].issueNumber).toBe(7);
  });
});
