import { mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { rootLogger } from '../utils/logger.js';
import type { FrontierTask, FrontierConfig, PipelineResult } from './types.js';
import { runPipeline } from './pipeline.js';

const log = rootLogger.child({ module: 'frontier-harness' });

export interface HarnessConfig {
  repoCloneDir: string;
  maxConcurrentTasks: number;
  cleanupOnComplete: boolean;
}

const DEFAULT_HARNESS_CONFIG: HarnessConfig = {
  repoCloneDir: '/tmp/frontier-tasks',
  maxConcurrentTasks: 2,
  cleanupOnComplete: true,
};

interface RunningTask {
  task: FrontierTask;
  startedAt: number;
  abort: () => void;
}

const runningTasks = new Map<string, RunningTask>();

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

function cloneRepoSync(repoUrl: string, targetDir: string, branch?: string): void {
  const branchFlag = branch ? `--branch ${branch}` : '';
  execSync(`git clone ${branchFlag} --depth 1 ${repoUrl} ${targetDir}`, { stdio: 'pipe', timeout: 120_000 });
}

function removeDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    log.warn({ dir }, 'Failed to cleanup task directory');
  }
}

export async function executeTask(
  task: FrontierTask,
  frontierConfig: FrontierConfig,
  harnessConfig?: Partial<HarnessConfig>,
): Promise<PipelineResult> {
  const config = { ...DEFAULT_HARNESS_CONFIG, ...harnessConfig };
  const taskDir = `${config.repoCloneDir}/${task.id}`;
  let aborted = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const abort = () => { aborted = true; };
  const runningTask: RunningTask = { task, startedAt: Date.now(), abort };
  runningTasks.set(task.id, runningTask);

  const abortPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      aborted = true;
      reject(new Error(`Task ${task.id} timed out after ${task.timeoutMs}ms`));
    }, task.timeoutMs);
  });

  try {
    ensureDir(config.repoCloneDir);
    log.info({ taskId: task.id, repoUrl: task.repoUrl }, 'Cloning task repository');
    cloneRepoSync(task.repoUrl, taskDir, task.branch);

    const pipelinePromise = runPipeline(task, frontierConfig, (event) => {
      if (aborted) return;
      log.info({ taskId: task.id, event }, 'Pipeline event');
    });

    const result = await Promise.race([pipelinePromise, abortPromise]);
    return result;
  } catch (err) {
    return {
      taskId: task.id,
      passed: false,
      score: 0,
      totalStages: 8,
      completedStages: 0,
      durationMs: Date.now() - runningTask.startedAt,
      candidateUrls: [],
      error: `Harness error: ${String(err)}`,
    };
  } finally {
    clearTimeout(timeoutId);
    runningTasks.delete(task.id);
    if (config.cleanupOnComplete) {
      await removeDir(taskDir);
    }
  }
}

export function getRunningTasks(): Array<{ taskId: string; runningForMs: number }> {
  return Array.from(runningTasks.entries()).map(([id, rt]) => ({
    taskId: id,
    runningForMs: Date.now() - rt.startedAt,
  }));
}

export function abortTask(taskId: string): boolean {
  const running = runningTasks.get(taskId);
  if (!running) return false;
  running.abort();
  return true;
}
