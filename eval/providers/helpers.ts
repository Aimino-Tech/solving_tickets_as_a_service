import type { EvalTestCase, EvalResult } from './types.js';

export function parseTestCase(prompt: string): EvalTestCase {
  try {
    return JSON.parse(prompt);
  } catch {
    // Fallback: try YAML-like parsing
    const lines = prompt.split('\n').filter(l => l.includes(':'));
    const obj: Record<string, string> = {};
    for (const line of lines) {
      const [key, ...rest] = line.split(':');
      if (key && rest.length) {
        obj[key.trim()] = rest.join(':').trim();
      }
    }
    return {
      issueTitle: obj.issueTitle || 'Unknown issue',
      issueDescription: obj.issueDescription || '',
      repo: obj.repo || 'unknown/repo',
      expectedOutcome: 'pr_created',
      timeoutMs: parseInt(obj.timeoutMs || '300000', 10),
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function runAgentCommand(
  sandbox: { runCommand: (cmd: string) => Promise<{ stdout: string; stderr: string; exitCode: number }> },
  command: string,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const result = await sandbox.runCommand(command);
    return result;
  } catch (err) {
    return {
      stdout: '',
      stderr: String(err),
      exitCode: -1,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function evaluateResult(
  result: { stdout: string; stderr: string; exitCode: number },
  testCase: EvalTestCase,
): EvalResult {
  const hasPR = result.stdout.includes('PR created') || result.stdout.includes('Merge Request');
  const hasFix = result.stdout.includes('fix applied') || result.stdout.includes('changes made');
  const isError = result.exitCode !== 0 && !hasPR && !hasFix;

  let passed = false;
  switch (testCase.expectedOutcome) {
    case 'pr_created':
      passed = hasPR;
      break;
    case 'fix_applied':
      passed = hasFix;
      break;
    case 'error_returned':
      passed = isError;
      break;
  }

  return {
    passed,
    result: {
      status: passed ? 'passed' : 'failed',
      summary: result.stdout.slice(0, 500) || result.stderr.slice(0, 500),
    },
    artifacts: {
      logs: result.stdout + '\n' + result.stderr,
      changedFiles: [],
      testOutput: result.stdout,
    },
  };
}
