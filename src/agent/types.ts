/**
 * Agent type definitions — result types and tool interface.
 */

export interface TestResult {
  passed: boolean;
  output: string;
  command: string;
  durationMs: number;
}

export interface AgentTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<string>;
}

export interface TriageResult {
  type: 'bug' | 'feature' | 'question' | 'unknown';
  difficulty: 'easy' | 'medium' | 'hard' | 'unknown';
  relevantFiles?: string[];
  summary: string;
}

export interface FileChange {
  path: string;
  originalContent: string;
  newContent: string;
  action: 'create' | 'modify' | 'delete';
}

export interface AgentResult {
  summary: string;
  confidence: 'high' | 'medium' | 'low';
  fixReady: boolean;
  prUrl?: string;
  branchName?: string;
  diff?: string;
  testOutput?: string;
  errors?: string[];
  relevantPRs?: Array<{ url: string; title: string; state: string }>;
  noFixReason?: string;
  alreadyFixed?: boolean;
  investigationOnly?: boolean;
  /** Agent produced a fix but it failed verification (tests didn't pass). */
  verificationFailed?: boolean;
}
