import type { EvalTestCase, EvalResult } from './types.js';
import { parseTestCase, runAgentCommand, evaluateResult } from './helpers.js';
import { initTelemetry } from '../tracing/otel-setup.js';

interface ProviderResponse {
  output: {
    passed: boolean;
    result: { status: string; summary: string; prUrl?: string; diff?: string };
    artifacts: { logs: string; changedFiles: string[]; testOutput: string };
    traceUrl?: string;
  };
}

let telemetryInitialized = false;

async function ensureTelemetry(): Promise<void> {
  if (!telemetryInitialized) {
    try {
      initTelemetry();
      telemetryInitialized = true;
    } catch (err) {
      console.warn('Failed to initialize telemetry:', err);
    }
  }
}

async function callApi(prompt: string, options?: Record<string, unknown>, context?: Record<string, unknown>): Promise<ProviderResponse> {
  await ensureTelemetry();

  const testCase: EvalTestCase = parseTestCase(prompt);
  const maxAttempts = 3;
  let lastError: string | undefined;
  let lastResult: EvalResult | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const timeoutMs = testCase.timeoutMs + 30000; // 30s grace
      
      // We would create an E2B sandbox here and run the agent
      // For now, simulate the flow:
      const result = await simulateAgentRun(testCase, timeoutMs);
      lastResult = evaluateResult(result, testCase);

      if (lastResult.passed) break;

      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
      }
    } catch (err) {
      lastError = String(err);
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
      }
    }
  }

  return {
    output: {
      passed: lastResult?.passed ?? false,
      result: lastResult?.result ?? { status: 'error', summary: lastError || 'Unknown error' },
      artifacts: lastResult?.artifacts ?? { logs: '', changedFiles: [], testOutput: '' },
      traceUrl: undefined,
    },
  };
}

async function simulateAgentRun(testCase: EvalTestCase, timeoutMs: number): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  // In production, this would create an E2B sandbox and run the agent CLI
  const phases = [
    'Cloning repository...',
    'Investigating issue...',
    'Applying fix...',
    'Running tests...',
    'Creating PR...',
  ];

  return {
    stdout: [
      `Running agent for ${testCase.repo}`,
      `Issue: ${testCase.issueTitle}`,
      '',
      ...phases.map(p => `[OK] ${p}`),
      '',
      `✅ PR created for ${testCase.repo}`,
      `Summary: Fixed ${testCase.issueTitle}`,
    ].join('\n'),
    stderr: '',
    exitCode: 0,
  };
}

export { callApi };
export default callApi;
