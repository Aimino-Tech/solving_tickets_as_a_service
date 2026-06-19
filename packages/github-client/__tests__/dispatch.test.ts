import { describe, expect, it, vi } from 'vitest';
import { dispatchAction } from '../src/dispatch.js';
import type { AgentResult } from '../src/messages.js';

function makeResult(overrides: Partial<AgentResult> = {}): AgentResult {
  return { summary: 'Fixed', fixReady: true, confidence: 'high', verification: { details: [] }, ...overrides };
}

describe('dispatch', () => {
  it('posts already-fixed comment and returns comment_posted', async () => {
    const result = makeResult({ alreadyFixed: true });
    const postComment = vi.fn();
    const action = await dispatchAction(
      { octokit: {} as any, postComment, pushBranch: vi.fn() },
      { issueNumber: 1, issueTitle: 'Bug', agentResult: result, repoOwner: 'owner', repoName: 'repo' },
    );
    expect(action.action).toBe('comment_posted');
    expect(postComment).toHaveBeenCalledOnce();
  });

  it('posts no-fix comment when fixReady is false', async () => {
    const result = makeResult({ fixReady: false, noFixReason: 'Cannot reproduce' });
    const postComment = vi.fn();
    const action = await dispatchAction(
      { octokit: {} as any, postComment, pushBranch: vi.fn() },
      { issueNumber: 1, issueTitle: 'Bug', agentResult: result, repoOwner: 'owner', repoName: 'repo' },
    );
    expect(action.action).toBe('comment_posted');
  });

  it('posts investigation comment for investigation-only', async () => {
    const result = makeResult({ investigationOnly: true });
    const postComment = vi.fn();
    const action = await dispatchAction(
      { octokit: {} as any, postComment, pushBranch: vi.fn() },
      { issueNumber: 1, issueTitle: 'Bug', agentResult: result, repoOwner: 'owner', repoName: 'repo' },
    );
    expect(action.action).toBe('comment_posted');
  });

  it('creates PR for high confidence', async () => {
    const result = makeResult({ confidence: 'high' });
    const postComment = vi.fn();
    const pushBranch = vi.fn();
    const octokit = {
      pulls: { create: vi.fn().mockResolvedValue({ data: { number: 42, html_url: 'https://github.com/pulls/42' } }) },
    };
    const action = await dispatchAction(
      { octokit: octokit as any, postComment, pushBranch },
      { issueNumber: 1, issueTitle: 'Bug', agentResult: result, repoOwner: 'owner', repoName: 'repo' },
    );
    expect(action.action).toBe('pr_created');
    expect(action.prNumber).toBe(42);
    expect(pushBranch).toHaveBeenCalledOnce();
  });

  it('creates draft PR for medium confidence', async () => {
    const result = makeResult({ confidence: 'medium' });
    const postComment = vi.fn();
    const pushBranch = vi.fn();
    const octokit = {
      pulls: { create: vi.fn().mockResolvedValue({ data: { number: 7, html_url: 'https://github.com/pulls/7' } }) },
    };
    const action = await dispatchAction(
      { octokit: octokit as any, postComment, pushBranch },
      { issueNumber: 1, issueTitle: 'Bug', agentResult: result, repoOwner: 'owner', repoName: 'repo' },
    );
    expect(action.action).toBe('draft_pr_created');
    expect(action.prNumber).toBe(7);
  });

  it('posts low confidence comment for low confidence', async () => {
    const result = makeResult({ confidence: 'low', testOutput: 'FAIL' });
    const postComment = vi.fn();
    const pushBranch = vi.fn();
    const action = await dispatchAction(
      { octokit: {} as any, postComment, pushBranch },
      { issueNumber: 1, issueTitle: 'Bug', agentResult: result, repoOwner: 'owner', repoName: 'repo' },
    );
    expect(action.action).toBe('comment_posted');
  });

  it('regression block prevents PR creation', async () => {
    const result = makeResult({ confidence: 'high', verification: { preExistingTestsRegressed: true, details: ['test regression'] } });
    const postComment = vi.fn();
    const pushBranch = vi.fn();
    const octokit = { pulls: { create: vi.fn() } };
    const action = await dispatchAction(
      { octokit: octokit as any, postComment, pushBranch },
      { issueNumber: 1, issueTitle: 'Bug', agentResult: result, repoOwner: 'owner', repoName: 'repo' },
    );
    expect(action.action).toBe('comment_posted');
    expect(octokit.pulls.create).not.toHaveBeenCalled();
  });

  it('uses getChangedFiles callback when provided', async () => {
    const result = makeResult({ confidence: 'high' });
    const getChangedFiles = vi.fn().mockResolvedValue(['src/index.ts']);
    const postComment = vi.fn();
    const pushBranch = vi.fn();
    const octokit = {
      pulls: { create: vi.fn().mockResolvedValue({ data: { number: 1, html_url: 'https://github.com/pulls/1' } }) },
    };
    await dispatchAction(
      { octokit: octokit as any, postComment, pushBranch, getChangedFiles },
      { issueNumber: 1, issueTitle: 'Bug', agentResult: result, repoOwner: 'owner', repoName: 'repo' },
    );
    expect(getChangedFiles).toHaveBeenCalledOnce();
  });

  it('returns error action on exception', async () => {
    const postComment = vi.fn().mockRejectedValue(new Error('API down'));
    const action = await dispatchAction(
      { octokit: {} as any, postComment, pushBranch: vi.fn() },
      { issueNumber: 1, issueTitle: 'Bug', agentResult: makeResult({ fixReady: false }) as any, repoOwner: 'owner', repoName: 'repo' },
    );
    expect(action.action).toBe('error');
  });
});
