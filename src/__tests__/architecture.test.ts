import { describe, it, expect } from 'vitest';
import { filesOfProject } from 'tsarch';

describe('no mock on core infrastructure', () => {
  it('test files must not import SandboxExecutor (except executor test files)', { timeout: 60000 }, async () => {
    const violations = await filesOfProject()
      .matchingPattern('.*/__tests__/(?!sandbox/).*')
      .shouldNot()
      .dependOnFiles()
      .matchingPattern('.*/sandbox/executor')
      .check();
    expect(violations).toEqual([]);
  });

  it('test files must not import qualityGates module (except qualityGates-related test files)', { timeout: 60000 }, async () => {
    const violations = await filesOfProject()
      .matchingPattern('.*/__tests__/(?!agent/(?:qualityGates|hallucinationGates|syntheticDataCheck)\\.test).*')
      .shouldNot()
      .dependOnFiles()
      .matchingPattern('.*/agent/qualityGates')
      .check();
    expect(violations).toEqual([]);
  });
});
