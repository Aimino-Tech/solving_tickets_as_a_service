export type PipelineState =
  | 'init'
  | 'fingerprint'
  | 'deconstruct'
  | 'generate'
  | 'implement'
  | 'verify'
  | 'rank'
  | 'submit'
  | 'failed';

export type PipelineEvent =
  | { type: 'transition'; from: PipelineState; to: PipelineState }
  | { type: 'error'; state: PipelineState; error: string }
  | { type: 'progress'; state: PipelineState; message: string }
  | { type: 'complete'; result: PipelineResult };

export interface PipelineResult {
  taskId: string;
  passed: boolean;
  score: number;
  totalStages: number;
  completedStages: number;
  durationMs: number;
  candidateUrls: string[];
  error?: string;
}

export interface FrontierTask {
  id: string;
  repoUrl: string;
  branch?: string;
  description: string;
  timeoutMs: number;
  tokenBudget: Record<string, number>;
}

export interface RepositoryFingerprint {
  language: string;
  framework: string;
  testFramework: string;
  deps: string[];
  fileCount: number;
  sloc: number;
  hasDockerfile: boolean;
  hasCiConfig: boolean;
}

export interface TaskDeconstruction {
  subtasks: string[];
  estimatedComplexity: 'low' | 'medium' | 'high';
  requiredFiles: string[];
  testFiles: string[];
  dependencies: string[];
}

export interface Strategy {
  id: string;
  description: string;
  approach: string;
  expectedDifficulty: number;
}

export interface ImplementationCandidate {
  id: string;
  strategyId: string;
  files: Array<{ path: string; content: string }>;
  testResults: TestResult;
  score: number;
  durationMs: number;
}

export interface TestResult {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  output: string;
}

export interface VerificationResult {
  candidateId: string;
  verifierScores: number[];
  aggregateScore: number;
  issues: string[];
  passed: boolean;
}

export interface FailureDiagnosis {
  stage: PipelineState;
  error: string;
  rootCause: string;
  suggestedFix: string;
  retryable: boolean;
}

export interface ScoreEntry {
  taskId: string;
  passed: boolean;
  score: number;
  durationMs: number;
  stagesCompleted: number;
  totalStages: number;
  cost: Record<string, number>;
  blockers: string[];
  timestamp: number;
}

export interface FrontierStatus {
  totalTasks: number;
  passedTasks: number;
  failedTasks: number;
  passRate: number;
  averageScore: number;
  scoreDistribution: number[];
  totalCost: Record<string, number>;
  blockerFrequency: Record<string, number>;
  recentTasks: ScoreEntry[];
}

export interface MCPToolConfig {
  baseUrl: string;
  timeoutMs: number;
  headers?: Record<string, string>;
}

export interface FrontierConfig {
  aetherCommand: MCPToolConfig;
  ocVision?: MCPToolConfig;
  opencode: MCPToolConfig;
  defaultTimeoutMs: number;
  maxRetries: number;
}
