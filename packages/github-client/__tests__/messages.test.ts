import { describe, expect, it } from 'vitest';
import {
  highConfidenceIssueComment,
  draftIssueComment,
  lowConfidenceComment,
  noFixComment,
  noResultComment,
  investigationComment,
  alreadyFixedComment,
  errorComment,
  featureSkipComment,
  questionSkipComment,
  timeoutComment,
  retryComment,
  phantomIssueComment,
  ciFailureComment,
  buildPRBody,
  type AgentResult,
} from '../src/messages.js';

function makeResult(overrides: Partial<AgentResult> = {}): AgentResult {
  return { summary: 'Fixed the bug', fixReady: true, verification: { details: [] }, ...overrides };
}

describe('messages', () => {
  it('highConfidenceIssueComment includes PR number', () => {
    const result = makeResult({ confidence: 'high' });
    const body = highConfidenceIssueComment(42, result);
    expect(body).toContain('PR ##42');
    expect(body).toContain('High');
  });

  it('draftIssueComment includes draft markers', () => {
    const result = makeResult({ confidence: 'medium' });
    const body = draftIssueComment(42, result);
    expect(body).toContain('Draft PR');
  });

  it('lowConfidenceComment includes test output', () => {
    const result = makeResult({ confidence: 'low', errors: ['test failed'] });
    const body = lowConfidenceComment(result, 'FAIL: something');
    expect(body).toContain('Low');
    expect(body).toContain('FAIL: something');
  });

  it('noFixComment includes reason', () => {
    const result = makeResult({ fixReady: false, noFixReason: 'Could not reproduce' });
    const body = noFixComment(result);
    expect(body).toContain('Could Not Fix');
    expect(body).toContain('Could not reproduce');
  });

  it('noFixComment includes relevant PRs', () => {
    const result = makeResult({ fixReady: false, noFixReason: 'Already fixed' });
    const body = noFixComment(result, [{ url: 'https://github.com/pulls/1', title: 'Fix the bug', state: 'open' }]);
    expect(body).toContain('Fix the bug');
  });

  it('noResultComment returns expected text', () => {
    const body = noResultComment();
    expect(body).toContain('Unexpected Result');
  });

  it('investigationComment includes summary', () => {
    const body = investigationComment('Investigated the issue');
    expect(body).toContain('Investigation Results');
    expect(body).toContain('Investigated the issue');
  });

  it('alreadyFixedComment includes summary', () => {
    const result = makeResult({ alreadyFixed: true });
    const body = alreadyFixedComment(result);
    expect(body).toContain('Already Fixed');
  });

  it('errorComment truncates long messages', () => {
    const longMsg = 'x'.repeat(6000);
    const body = errorComment(longMsg);
    expect(body.length).toBeLessThan(5500);
  });

  it('featureSkipComment mentions feature requests', () => {
    const body = featureSkipComment();
    expect(body).toContain('Feature Request');
  });

  it('questionSkipComment mentions questions', () => {
    const body = questionSkipComment();
    expect(body).toContain('Question');
  });

  it('timeoutComment includes phase name and duration', () => {
    const body = timeoutComment('sandbox', 300_000);
    expect(body).toContain('sandbox');
    expect(body).toContain('300s');
  });

  it('retryComment includes attempt number', () => {
    const body = retryComment(2, 'gpt-4', 'timeout');
    expect(body).toContain('Attempt 2');
    expect(body).toContain('gpt-4');
  });

  it('phantomIssueComment includes missing files', () => {
    const body = phantomIssueComment(['src/foo.ts'], 'Files do not exist');
    expect(body).toContain('src/foo.ts');
  });

  it('ciFailureComment includes failed checks', () => {
    const body = ciFailureComment(42, ['test / unit']);
    expect(body).toContain('test / unit');
  });

  it('buildPRBody generates full PR content', () => {
    const result = makeResult({ summary: 'Bug fix' });
    const body = buildPRBody({ issueNumber: 1, result, fileLinks: ['src/index.ts'], isDraft: false, branchName: 'fix/test' });
    expect(body).toContain('Bug fix');
    expect(body).toContain('src/index.ts');
    expect(body).toContain('Closes #1');
  });

  it('custom botName appears in output', () => {
    const result = makeResult({ confidence: 'high' });
    const body = highConfidenceIssueComment(42, result, 'CustomBot');
    expect(body).toContain('CustomBot');
  });

  it('empty summary still produces valid markdown', () => {
    const result = makeResult({ summary: '' });
    const body = highConfidenceIssueComment(1, result);
    expect(body).toBeTruthy();
  });
});
