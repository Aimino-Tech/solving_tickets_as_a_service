import { rootLogger } from '../utils/logger.js';
import { recordScore } from './score.js';
import type {
  PipelineState,
  PipelineEvent,
  PipelineResult,
  FrontierTask,
  FrontierConfig,
  RepositoryFingerprint,
  TaskDeconstruction,
  Strategy,
  ImplementationCandidate,
  VerificationResult,
  FailureDiagnosis,
  ScoreEntry,
} from './types.js';

const log = rootLogger.child({ module: 'frontier-pipeline' });

type EventHandler = (event: PipelineEvent) => void;

interface StageContext {
  task: FrontierTask;
  config: FrontierConfig;
  fingerprint?: RepositoryFingerprint;
  deconstruction?: TaskDeconstruction;
  strategies?: Strategy[];
  candidates?: ImplementationCandidate[];
  verification?: VerificationResult;
  diagnosis?: FailureDiagnosis;
  errors: string[];
  startTime: number;
}

async function callMCPTool(baseUrl: string, toolName: string, params: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: toolName, params }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`MCP tool ${toolName} returned ${response.status}: ${await response.text()}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function stageFingerprint(ctx: StageContext, emit: EventHandler): Promise<StageContext> {
  emit({ type: 'progress', state: 'fingerprint', message: 'Fingerprinting repository' });
  const result = await callMCPTool(ctx.config.aetherCommand.baseUrl, 'fingerprint_repository', {
    repoUrl: ctx.task.repoUrl,
    branch: ctx.task.branch,
  }, ctx.config.aetherCommand.timeoutMs);
  ctx.fingerprint = result as RepositoryFingerprint;
  return ctx;
}

async function stageDeconstruct(ctx: StageContext, emit: EventHandler): Promise<StageContext> {
  emit({ type: 'progress', state: 'deconstruct', message: 'Deconstructing task' });
  const result = await callMCPTool(ctx.config.aetherCommand.baseUrl, 'deconstruct_task', {
    taskDescription: ctx.task.description,
    fingerprint: ctx.fingerprint,
  }, ctx.config.aetherCommand.timeoutMs);
  ctx.deconstruction = result as TaskDeconstruction;
  return ctx;
}

async function stageGenerate(ctx: StageContext, emit: EventHandler): Promise<StageContext> {
  emit({ type: 'progress', state: 'generate', message: 'Generating strategies' });
  const result = await callMCPTool(ctx.config.aetherCommand.baseUrl, 'generate_strategies', {
    task: ctx.task,
    deconstruction: ctx.deconstruction,
  }, ctx.config.aetherCommand.timeoutMs);
  ctx.strategies = result as Strategy[];
  return ctx;
}

async function stageImplement(ctx: StageContext, emit: EventHandler): Promise<StageContext> {
  emit({ type: 'progress', state: 'implement', message: 'Running implementation swarm' });
  const result = await callMCPTool(ctx.config.opencode.baseUrl, 'implementation_swarm', {
    task: ctx.task,
    strategies: ctx.strategies,
    fingerprint: ctx.fingerprint,
  }, ctx.config.opencode.timeoutMs);
  ctx.candidates = result as ImplementationCandidate[];
  return ctx;
}

async function stageVerify(ctx: StageContext, emit: EventHandler): Promise<StageContext> {
  emit({ type: 'progress', state: 'verify', message: 'Verifying candidates' });
  const result = await callMCPTool(ctx.config.aetherCommand.baseUrl, 'verify_candidate', {
    candidates: ctx.candidates,
    task: ctx.task,
  }, ctx.config.aetherCommand.timeoutMs);
  ctx.verification = result as VerificationResult;
  return ctx;
}

async function stageRank(ctx: StageContext, emit: EventHandler): Promise<StageContext> {
  emit({ type: 'progress', state: 'rank', message: 'Ranking candidates' });
  const result = await callMCPTool(ctx.config.aetherCommand.baseUrl, 'rank_candidates', {
    candidates: ctx.candidates,
    verification: ctx.verification,
  }, ctx.config.aetherCommand.timeoutMs);
  ctx.candidates = result as ImplementationCandidate[];
  return ctx;
}

async function stageSubmit(ctx: StageContext, emit: EventHandler): Promise<StageContext> {
  emit({ type: 'progress', state: 'submit', message: 'Submitting best candidate' });
  await callMCPTool(ctx.config.aetherCommand.baseUrl, 'submit_candidate', {
    candidate: ctx.candidates?.[0],
    task: ctx.task,
  }, ctx.config.aetherCommand.timeoutMs);
  return ctx;
}

const STAGE_ORDER: Array<{ state: PipelineState; fn: (ctx: StageContext, emit: EventHandler) => Promise<StageContext> }> = [
  { state: 'fingerprint', fn: stageFingerprint },
  { state: 'deconstruct', fn: stageDeconstruct },
  { state: 'generate', fn: stageGenerate },
  { state: 'implement', fn: stageImplement },
  { state: 'verify', fn: stageVerify },
  { state: 'rank', fn: stageRank },
  { state: 'submit', fn: stageSubmit },
];

export async function runPipeline(
  task: FrontierTask,
  config: FrontierConfig,
  onEvent?: EventHandler,
): Promise<PipelineResult> {
  const emit: EventHandler = (event) => {
    log.info({ event }, 'Pipeline event');
    onEvent?.(event);
  };

  const ctx: StageContext = {
    task,
    config,
    errors: [],
    startTime: Date.now(),
  };

  let currentState: PipelineState = 'init';
  let completedStages = 0;

  emit({ type: 'transition', from: 'init', to: 'fingerprint' });

  for (const stage of STAGE_ORDER) {
    currentState = stage.state;
    emit({ type: 'transition', from: ctx.errors.length > 0 ? 'failed' : currentState, to: stage.state });

    try {
      await stage.fn(ctx, emit);
      completedStages++;
      emit({ type: 'progress', state: stage.state, message: `${stage.state} completed` });
    } catch (err) {
      const errMsg = String(err);
      ctx.errors.push(errMsg);
      emit({ type: 'error', state: stage.state, error: errMsg });
      log.error({ err: errMsg, state: stage.state, taskId: task.id }, 'Pipeline stage failed');

      if (stage.state !== 'submit') {
        try {
          const diagnosis = await callMCPTool(config.aetherCommand.baseUrl, 'diagnose_failure', {
            stage: stage.state,
            error: errMsg,
            context: { fingerprint: ctx.fingerprint, deconstruction: ctx.deconstruction },
          }, config.aetherCommand.timeoutMs) as FailureDiagnosis;

          if (diagnosis.retryable && ctx.errors.length <= config.maxRetries) {
            log.info({ stage: stage.state, attempt: ctx.errors.length }, 'Retrying stage');
            try {
              await stage.fn(ctx, emit);
              completedStages++;
              // Retry succeeded — pop error so passed check passes
              ctx.errors.pop();
              continue;
            } catch (retryErr) {
              ctx.errors.push(String(retryErr));
            }
          }
        } catch {
          log.error({ state: stage.state }, 'Failure diagnosis failed');
        }
      }

      const result: PipelineResult = {
        taskId: task.id,
        passed: false,
        score: completedStages / STAGE_ORDER.length,
        totalStages: STAGE_ORDER.length,
        completedStages,
        durationMs: Date.now() - ctx.startTime,
        candidateUrls: [],
        error: errMsg,
      };

      const scoreEntry: ScoreEntry = {
        taskId: task.id,
        passed: false,
        score: result.score,
        durationMs: result.durationMs,
        stagesCompleted: completedStages,
        totalStages: STAGE_ORDER.length,
        cost: {},
        blockers: ctx.errors,
        timestamp: Date.now(),
      };
      recordScore(scoreEntry);

      emit({ type: 'complete', result });
      log.info({ result }, 'Pipeline failed');
      return result;
    }
  }

  const passed = ctx.errors.length === 0;
  const bestCandidate = ctx.candidates?.[0];
  const result: PipelineResult = {
    taskId: task.id,
    passed,
    score: passed ? 1.0 : completedStages / STAGE_ORDER.length,
    totalStages: STAGE_ORDER.length,
    completedStages,
    durationMs: Date.now() - ctx.startTime,
    candidateUrls: bestCandidate ? [`/candidates/${bestCandidate.id}`] : [],
  };

  const scoreEntry: ScoreEntry = {
    taskId: task.id,
    passed,
    score: result.score,
    durationMs: result.durationMs,
    stagesCompleted: completedStages,
    totalStages: STAGE_ORDER.length,
    cost: {},
    blockers: ctx.errors,
    timestamp: Date.now(),
  };
  recordScore(scoreEntry);

  emit({ type: 'complete', result });
  log.info({ result }, 'Pipeline completed');
  return result;
}
