export interface EvalTestCase {
  id: string;
  title: string;
  repo: string;
  timeoutMs: number;
  runCommand?: string;
  installCommand?: string;
}

export interface EvalSandboxConfig {
  templateId: string;
  timeoutMs: number;
  cpuCount: number;
  memoryMB: number;
  envVars: Record<string, string>;
}

export interface EvalResult {
  passed: boolean;
  output: string;
  durationMs: number;
  sandboxId: string;
  error?: string;
}

export class EvalTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvalTimeoutError';
  }
}

export class EvalSandboxError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'EvalSandboxError';
  }
}
