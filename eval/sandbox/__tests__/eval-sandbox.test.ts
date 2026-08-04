import { describe, it, expect, vi } from 'vitest';
import { EvalTimeoutError, EvalSandboxError } from '../types.js';
import { sanitizeEnvironment, createEvalSandbox } from '../eval-sandbox.js';
import {
  generateE2BNetworkConfig,
  createNetworkRestrictionScript,
  DEFAULT_ALLOWED_GIT_HOSTS,
} from '../network-policy.js';
import type { EvalTestCase } from '../types.js';

describe('EvalTimeoutError', () => {
  it('creates error with correct name and message', () => {
    const error = new EvalTimeoutError('Agent exceeded 300000ms');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('EvalTimeoutError');
    expect(error.message).toBe('Agent exceeded 300000ms');
  });
});

describe('EvalSandboxError', () => {
  it('creates error with message only', () => {
    const error = new EvalSandboxError('Sandbox creation failed');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('EvalSandboxError');
    expect(error.message).toBe('Sandbox creation failed');
    expect(error.cause).toBeUndefined();
  });

  it('creates error with message and cause', () => {
    const cause = new Error('Underlying issue');
    const error = new EvalSandboxError('Sandbox creation failed', cause);
    expect(error.cause).toBe(cause);
  });
});

describe('EvalTestCase interface shape', () => {
  it('supports minimal test case', () => {
    const testCase: EvalTestCase = {
      id: 'test-1',
      title: 'Simple test',
      repo: 'https://github.com/owner/repo',
      timeoutMs: 300000,
    };
    expect(testCase.id).toBe('test-1');
    expect(testCase.timeoutMs).toBe(300000);
  });

  it('supports full test case with commands', () => {
    const testCase: EvalTestCase = {
      id: 'test-2',
      title: 'Test with commands',
      repo: 'https://github.com/owner/repo',
      timeoutMs: 600000,
      runCommand: 'npm test',
      installCommand: 'npm ci',
    };
    expect(testCase.runCommand).toBe('npm test');
  });
});

describe('sanitizeEnvironment', () => {
  it('passes through non-sensitive vars', () => {
    const result = sanitizeEnvironment({ SYNTARO_EVAL_MODE: 'true', SYNTARO_REPO_URL: 'https://example.com' });
    expect(result).toEqual({ SYNTARO_EVAL_MODE: 'true', SYNTARO_REPO_URL: 'https://example.com' });
  });

  it('strips OPENAI_API_KEY', () => {
    const result = sanitizeEnvironment({ SYNTARO_EVAL_MODE: 'true', OPENAI_API_KEY: 'sk-xxx' });
    expect(result).toEqual({ SYNTARO_EVAL_MODE: 'true' });
    expect(result.OPENAI_API_KEY).toBeUndefined();
  });

  it('strips ANTHROPIC_API_KEY', () => {
    const result = sanitizeEnvironment({ SYNTARO_EVAL_MODE: 'true', ANTHROPIC_API_KEY: 'sk-ant-xxx' });
    expect(result).toEqual({ SYNTARO_EVAL_MODE: 'true' });
    expect(result.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('strips E2B_API_KEY', () => {
    const result = sanitizeEnvironment({ SYNTARO_EVAL_MODE: 'true', E2B_API_KEY: 'e2b_xxx' });
    expect(result).toEqual({ SYNTARO_EVAL_MODE: 'true' });
  });

  it('strips vars matching sensitive patterns case-insensitively', () => {
    const result = sanitizeEnvironment({ SYNTARO_EVAL_MODE: 'true', api_key: 'xxx', GITHUB_TOKEN: 'ghp_xxx' });
    expect(result).toEqual({ SYNTARO_EVAL_MODE: 'true' });
  });
});

describe('generateE2BNetworkConfig', () => {
  it('generates config for github.com only', () => {
    const result = generateE2BNetworkConfig(['github.com']);
    expect(result.allowOut).toContain('github.com');
    expect(result.allowPublicTraffic).toBe(false);
  });

  it('strips protocol prefixes from hosts', () => {
    const result = generateE2BNetworkConfig(['https://github.com', 'https://gitlab.com']);
    expect(result.allowOut).toContain('github.com');
    expect(result.allowOut).toContain('gitlab.com');
    expect(result.allowOut).not.toContain('https://github.com');
  });

  it('uses DEFAULT_ALLOWED_GIT_HOSTS when no custom hosts provided', () => {
    const result = generateE2BNetworkConfig(DEFAULT_ALLOWED_GIT_HOSTS);
    expect(result.allowOut).toContain('github.com');
    expect(result.allowOut).toContain('gitlab.com');
    expect(result.allowOut).toContain('raw.githubusercontent.com');
    expect(result.allowPublicTraffic).toBe(false);
  });
});

describe('createNetworkRestrictionScript', () => {
  it('generates iptables script with default hosts', () => {
    const script = createNetworkRestrictionScript(['github.com', 'gitlab.com']);
    expect(script).toContain('#!/bin/sh');
    expect(script).toContain('iptables -P INPUT DROP');
    expect(script).toContain('iptables -P OUTPUT DROP');
    expect(script).toContain('iptables -A OUTPUT -d github.com -p tcp --dport 443 -j ACCEPT');
    expect(script).toContain('iptables -A OUTPUT -d gitlab.com -p tcp --dport 443 -j ACCEPT');
    expect(script).toContain('iptables -A OUTPUT -j REJECT');
  });

  it('strips protocol from hosts', () => {
    const script = createNetworkRestrictionScript(['https://github.com']);
    expect(script).toContain('iptables -A OUTPUT -d github.com -p tcp --dport 443 -j ACCEPT');
    expect(script).not.toContain('https://');
  });
});

describe('createEvalSandbox', () => {
  it('returns an EvalSandbox instance', () => {
    const testCase: EvalTestCase = {
      id: 'test-1',
      title: 'Simple test',
      repo: 'https://github.com/owner/repo',
      timeoutMs: 300000,
    };
    const sandbox = createEvalSandbox(testCase);
    expect(sandbox).toBeDefined();
    expect(typeof sandbox.boot).toBe('function');
    expect(typeof sandbox.exec).toBe('function');
    expect(typeof sandbox.destroy).toBe('function');
  });
});
