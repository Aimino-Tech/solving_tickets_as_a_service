export interface TemplateConfig {
  name: string;
  labels: string[];
  phases: Record<string, StepConfig[]>;
  sessionMode?: 'new' | 'reuse' | 'parallel';
  retry?: RetryConfig;
}

export interface StepConfig {
  name: string;
  command: string;
  session: 'new' | 'reuse';
  retry?: RetryConfig;
}

export interface RetryConfig {
  maxAttempts: number;
  delayMs: number;
}

export interface StepContext {
  issue: {
    number: number;
    title: string;
    body: string | null;
    labels: string[];
  };
  repo: {
    owner: string;
    name: string;
  };
  template: {
    name: string;
  };
  phase: {
    name: string;
  };
}

export interface ResolvedCommand {
  command: string;
  placeholders: string[];
}
