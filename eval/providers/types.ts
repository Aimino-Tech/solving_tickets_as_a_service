export interface EvalTestCase {
  issueTitle: string;
  issueDescription: string;
  repo: string;
  expectedOutcome: 'pr_created' | 'fix_applied' | 'error_returned';
  expectedFiles?: string[];
  timeoutMs: number;
}

export interface EvalResult {
  passed: boolean;
  result: {
    status: string;
    summary: string;
    prUrl?: string;
    diff?: string;
  };
  artifacts: {
    logs: string;
    changedFiles: string[];
    testOutput: string;
  };
  traceUrl?: string;
}

export interface AgentTraceSpan {
  name: string;
  startTime: number;
  endTime?: number;
  attributes: Record<string, string | number | boolean>;
  status?: 'ok' | 'error';
  error?: string;
}
