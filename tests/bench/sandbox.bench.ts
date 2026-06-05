/**
 * Benchmark: Sandbox Boot Time (mocked)
 *
 * Measures the time to:
 * 1. Create a SandboxExecutor instance
 * 2. Simulate sandbox.create() with E2B API
 * 3. Simulate git clone (shallow, depth=1)
 * 4. Simulate runtime detection (checking package.json, go.mod, etc.)
 * 5. Simulate dependency installation
 *
 * In production this uses E2B cloud sandboxes (~5-15s boot time).
 * This mock simulates the overhead of the orchestration logic.
 */

import crypto from 'node:crypto';
import { bench, describe } from 'vitest';
import { createMockJobData } from './setup.js';

const jobData = createMockJobData();

interface RuntimeInfo {
  language: string;
  version: string;
  testCommand: string;
  installCommand: string;
  formatCommand: string;
  lintCommand: string;
}

// ── Simulated runtime detection ──────────────────────────────────────

const FILES_WITH_PACKAGE_JSON = [
  'package.json', 'tsconfig.json', 'node_modules/', 'src/', 'tests/',
];

function simulateLs(directory: string): string[] {
  if (directory.includes('test-repo')) return FILES_WITH_PACKAGE_JSON;
  return [];
}

function detectRuntime(files: string[]): RuntimeInfo {
  const fileSet = new Set(files);

  if (fileSet.has('package.json')) {
    const hasTypescript = fileSet.has('tsconfig.json');
    return {
      language: 'node',
      version: '22',
      testCommand: 'npm test 2>&1',
      installCommand: 'npm install',
      formatCommand: hasTypescript ? 'npx biome check --write . 2>&1 || true' : '',
      lintCommand: hasTypescript ? 'npx tsc --noEmit 2>&1' : 'npx eslint . 2>&1 || true',
    };
  }

  if (fileSet.has('go.mod')) {
    return {
      language: 'go',
      version: '1.22',
      testCommand: 'go test ./... 2>&1',
      installCommand: 'go mod download 2>&1',
      formatCommand: 'go fmt ./... 2>&1',
      lintCommand: 'go vet ./... 2>&1',
    };
  }

  if (fileSet.has('Cargo.toml')) {
    return {
      language: 'rust',
      version: '1.77',
      testCommand: 'cargo test 2>&1',
      installCommand: 'cargo fetch 2>&1',
      formatCommand: 'cargo fmt --all 2>&1',
      lintCommand: 'cargo clippy --all-targets -- -D warnings 2>&1 || true',
    };
  }

  return {
    language: 'unknown',
    version: '',
    testCommand: '',
    installCommand: '',
    formatCommand: '',
    lintCommand: '',
  };
}

// ── Simulated sandbox boot ───────────────────────────────────────────

interface SandboxInstance {
  sandboxId: string;
  repoDir: string;
  runtime: RuntimeInfo;
}

async function mockSandboxBoot(repoUrl: string, repoName: string): Promise<SandboxInstance> {
  const sandboxId = 'mock-sb-' + crypto.randomUUID().slice(0, 8);

  // Simulate git clone command string construction
  const authUrl = repoUrl.replace('https://', 'https://x-access-token:mock-token@');
  const repoDir = `/home/user/${repoName}`;
  const cloneCmd = `git clone --depth 1 ${authUrl} ${repoDir}`;

  // Detect runtime from file listing
  const files = simulateLs(repoDir);
  const runtime = detectRuntime(files);

  // Simulate install command string construction
  const installCmd = runtime.installCommand;

  return {
    sandboxId,
    repoDir,
    runtime,
  };
}

describe('sandbox-boot', () => {
  bench('simulate ls (list files)', () => {
    simulateLs('/home/user/test-repo');
  });

  bench('detect runtime from file listing', () => {
    detectRuntime(FILES_WITH_PACKAGE_JSON);
  });

  bench('construct git clone URL with auth token', () => {
    const repoUrl = `https://github.com/${jobData.repoOwner}/${jobData.repoName}`;
    repoUrl.replace('https://', 'https://x-access-token:mock-token@');
  });

  bench('full sandbox boot orchestration (mocked)', async () => {
    const repoUrl = `https://github.com/${jobData.repoOwner}/${jobData.repoName}`;
    await mockSandboxBoot(repoUrl, jobData.repoName);
  });
});
