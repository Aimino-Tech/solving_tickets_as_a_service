/**
 * Shared sandbox types — interfaces and result types for sandbox implementations.
 *
 * Both E2BSandboxExecutor and DockerSandbox implement SandboxExecutor.
 */

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface TestRunResult {
  passed: boolean;
  output: string;
  command: string;
  durationMs: number;
}

export interface RuntimeInfo {
  language: string;
  version: string;
  testCommand: string;
  installCommand: string;
  formatCommand: string;
  lintCommand: string;
}

// ---------------------------------------------------------------------------
// Common interface
// ---------------------------------------------------------------------------

export type ProgressCallback = (phase: string, progress: number, message?: string) => void;

export interface SandboxExecutor {
  /** Boot the sandbox: create instance, clone repo, detect runtime, install deps. */
  boot(onProgress?: ProgressCallback): Promise<void>;

  /** Execute a command in the sandbox. */
  exec(command: string, timeoutMs?: number): Promise<ExecResult>;

  /** Convenience wrapper for tool commands. */
  execForTools(command: string, timeoutMs?: number): Promise<ExecResult>;

  /** Read a file from the sandbox with path traversal protection. */
  readFile(filePath: string): Promise<string>;

  /** Write a file in the sandbox with path traversal protection. */
  writeFile(filePath: string, content: string): Promise<void>;

  /** Remove a file from the sandbox with path traversal protection. */
  removeFile(filePath: string): Promise<void>;

  /** Push changes to a new branch on GitHub. */
  pushBranch(branchName: string): Promise<void>;

  /** Check if the project has a test suite configured. */
  hasTestSuite(): boolean;

  /** Run a specific test file or test pattern. */
  runSpecificTest(testPath: string): Promise<TestRunResult>;

  /** Auto-detect and run the test suite. */
  runTests(): Promise<TestRunResult>;

  /** Auto-format modified files. */
  formatCode(): Promise<void>;

  /** Run static analysis on the codebase. */
  analyzeCode(): Promise<string>;

  /** Auto-detect the project runtime environment. */
  detectRuntime(): Promise<RuntimeInfo>;

  /** Install dependencies based on detected runtime. */
  installDeps(): Promise<void>;

  /** Destroy the sandbox and clean up resources. */
  destroy(): Promise<void>;
}
