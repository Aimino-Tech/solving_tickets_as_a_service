import { rootLogger } from '../utils/logger.js';
import type { IssueJobData } from '../utils/types.js';
import { getLoadedTemplate, getResolvedCommand } from '../template/loader.js';
import type { LoadedTemplate } from '../template/loader.js';
import { advanceSession, createSession, failSession, getSession, retrySession } from './sessionOrchestrator.js';
import { getPhaseStage } from './stateMachine.js';
import type { ConfinementConfig, PhaseStepResult, PipelinePhase, PhaseStepInfo, PipelineConfigRun, SessionState } from './types.js';
import { GateRunner } from './gates/gateRunner.js';
import { updatePipelineRunMetrics, getPipelineVersionChain, createPipelineRun, resolveConfig } from './pipelineConfigResolver.js';
import type { GateCheckInput, GatesConfig, GateRunnerResult } from './gates/types.js';

const log = rootLogger.child({ module: 'pipeline-executor' });

export const ALL_PHASES: PipelinePhase[] = ['pre', 'main', 'post', 'final'];

interface AdvanceResult {
  success: boolean;
  error?: string;
  output?: string;
  tokenCost?: number;
}

type ExtendedSession = SessionState & {
  templateName: string;
  phaseOrder: PipelinePhase[];
  currentPhaseIndex: number;
  currentStepIndex: number;
  phaseHistory: PhaseStepInfo[];
  lastPhaseOutput?: string;
  cumulativeTokens?: number;
};

/**
 * Template-driven pipeline executor.
 *
 * Resolves a loaded template, creates a pipeline session, and walks through
 * each phase (pre → main → post → final) step by step.  The caller is
 * responsible for actually running the resolved command; the executor only
 * resolves, tracks, and advances state.
 *
 * Usage:
 *   const executor = new PipelineExecutor(job, templateName);
 *   const step = await executor.start();
 *   // caller runs step.command externally
 *   const next = await executor.advance(sessionId, { success: true });
 */
export class PipelineExecutor {
  private readonly job: IssueJobData;
  private readonly templateName: string;
  private template: LoadedTemplate | null = null;
  private readonly context: Record<string, string>;
  private phaseOrder: PipelinePhase[] = [];
  private readonly confinement: ConfinementConfig;
  private pipelineRun: PipelineConfigRun | null = null;

  /** Per-issue error signature history for dead-end detection. Key = owner/repo#number. */
  private static readonly errorSignatures: Map<string, Set<string>> = new Map();

  constructor(job: IssueJobData, templateName: string, confinement?: ConfinementConfig) {
    this.job = job;
    this.templateName = templateName;
    this.context = buildContext(job);
    this.confinement = confinement ?? {
      loopDetectionEnabled: false,
      deadEndDetectionEnabled: false,
    };
  }

  /** Clear all tracked error signatures (for testing / reset). */
  static clearErrorHistory(): void {
    PipelineExecutor.errorSignatures.clear();
  }

  /**
   * Resolve the template, create a pipeline session, and return the first
   * step to execute.  Returns `completed: true` when there are no phases.
   */
  async start(): Promise<PhaseStepResult> {
    this.template = getLoadedTemplate(this.templateName) ?? null;
    if (!this.template) {
      const msg = `Template "${this.templateName}" not found`;
      log.warn({ templateName: this.templateName }, msg);
      return { success: false, completed: false, error: msg };
    }

    // If this is a pipeline template, resolve config from the issue body
    // and create a versioned PipelineConfigRun (AIM-2537).
    if (this.templateName === 'syntaro:pipeline' || this.job.labels?.some((l) => l.startsWith('pipeline:') || l.startsWith('syntaro:pipeline'))) {
      this.pipelineRun = this.resolvePipelineConfig();
      Object.assign(this.context, buildPipelineContext(this.pipelineRun));
    }

    this.phaseOrder = ALL_PHASES.filter(
      (p) => this.template!.phases[p] && this.template!.phases[p].length > 0,
    );

    if (this.phaseOrder.length === 0) {
      log.warn({ templateName: this.templateName }, 'Template has no phases to execute');
      return { success: true, completed: true };
    }

    const issueId = `${this.job.repoOwner}/${this.job.repoName}#${this.job.issueNumber}`;

    const session = createSession(issueId, this.templateName) as ExtendedSession;
    session.templateName = this.template.name;
    session.phaseOrder = [...this.phaseOrder];
    session.currentPhaseIndex = 0;
    session.currentStepIndex = 0;
    session.phaseHistory = [];
    session.lastPhaseOutput = undefined;
    session.cumulativeTokens = 0;

    log.info(
      { sessionId: session.sessionId, templateName: this.template.name, phases: this.phaseOrder },
      'Pipeline executor started',
    );

    return this.resolveStep(session);
  }

  /**
   * Advance the pipeline after a step completes (or fails).
   *
   * On success: moves to the next step in the current phase or advances to
   * the next phase.  On failure: retries if attempts remain, otherwise marks
   * the session as failed.
   */
  async advance(
    sessionId: string,
    result: AdvanceResult,
  ): Promise<PhaseStepResult> {
    if (result.success) {
      // Accumulate token cost for budget tracking
      if (result.tokenCost && result.tokenCost > 0) {
        const session = getSession(sessionId) as ExtendedSession | undefined;
        if (session) {
          session.cumulativeTokens = (session.cumulativeTokens ?? 0) + result.tokenCost;
        }
      }

      // Check cost budget before advancing
      if (this.confinement.costBudget) {
        const budgetHit = this.checkBudget(sessionId, result.tokenCost);
        if (budgetHit) {
          return this.markBudgetExhausted(sessionId);
        }
      }

      // Loop detection: check if this phase's output matches the previous
      if (this.confinement.loopDetectionEnabled && result.output !== undefined) {
        const loopHit = this.checkLoop(sessionId, result.output);
        if (loopHit) {
          return this.markPhaseStuck(sessionId);
        }
      }

      return this.advanceStep(sessionId, result.output);
    }

    // Dead-end detection: record error and check for recurring signature
    if (this.confinement.deadEndDetectionEnabled && result.error) {
      const deadEnd = this.recordAndCheckDeadEnd(sessionId, result.error);
      if (deadEnd) {
        return this.handleDeadEnd(sessionId, result.error);
      }
    }

    return this.handleFailure(sessionId, result.error);
  }

  /**
   * Return current progress information for the given session.
   */
  getProgress(sessionId: string): {
    currentPhase: PipelinePhase | null;
    currentStep: number;
    totalPhases: number;
    totalStepsInPhase: number;
    percentComplete: number;
  } {
    const session = getSession(sessionId) as SessionState & {
      phaseOrder?: PipelinePhase[];
      currentPhaseIndex?: number;
      currentStepIndex?: number;
    };
    if (!session || !session.phaseOrder) {
      return { currentPhase: null, currentStep: 0, totalPhases: 0, totalStepsInPhase: 0, percentComplete: 0 };
    }

    const phaseIdx = session.currentPhaseIndex ?? 0;
    const stepIdx = session.currentStepIndex ?? 0;
    const phase = session.phaseOrder[phaseIdx] ?? null;
    const totalPhases = session.phaseOrder.length;
    const totalStepsInPhase = phase && this.template?.phases[phase]
      ? this.template.phases[phase].length
      : 0;

    const completedPhases = phaseIdx;
    const completedSteps = stepIdx;
    const totalStepsAcrossAllPhases = this.phaseOrder.reduce(
      (sum, p) => sum + (this.template?.phases[p]?.length ?? 0),
      0,
    );
    const allDone = completedPhases >= totalPhases;
    const percentComplete = totalStepsAcrossAllPhases > 0 && !allDone
      ? completedSteps / totalStepsAcrossAllPhases
      : allDone ? 1 : 0;

    return { currentPhase: phase, currentStep: stepIdx, totalPhases, totalStepsInPhase, percentComplete };
  }

  // ── Private helpers ──────────────────────────────────────────────────

  private resolveStep(session: SessionState): PhaseStepResult {
    const extended = session as ExtendedSession;

    if ((extended.currentPhaseIndex ?? 0) >= (extended.phaseOrder?.length ?? 0)) {
      const finalSession = advanceSession(session.sessionId, 'completed');
      log.info({ sessionId: session.sessionId }, 'All phases complete');
      return {
        success: true,
        completed: true,
        session: finalSession,
      };
    }

    // Check cost budget before entering a NEW phase (stepIndex === 0)
    if (
      this.confinement.costBudget &&
      extended.currentStepIndex === 0 &&
      extended.cumulativeTokens !== undefined &&
      extended.cumulativeTokens >= this.confinement.costBudget.maxTokens
    ) {
      log.warn(
        { sessionId: session.sessionId, cumulativeTokens: extended.cumulativeTokens, maxTokens: this.confinement.costBudget.maxTokens },
        'Budget exhausted — cumulative tokens exceed maxTokens',
      );
      return this.markBudgetExhausted(session.sessionId);
    }

    const phase = extended.phaseOrder[extended.currentPhaseIndex];
    const stepIndex = extended.currentStepIndex;
    const phaseStage = getPhaseStage(phase);

    if (!phaseStage) {
      const msg = `Unknown phase "${phase}"`;
      log.error({ sessionId: session.sessionId, phase }, msg);
      return { success: false, completed: false, error: msg };
    }

    // Advance state machine to this phase stage on first entry
    if (session.currentStage !== phaseStage) {
      advanceSession(session.sessionId, phaseStage);
    }

    const command = getResolvedCommand(
      this.templateName,
      phase,
      stepIndex,
      this.context,
    );

    if (!command) {
      // No more steps in this phase — move to next phase
      return this.moveToNextPhase(session);
    }

    const stepInfo: PhaseStepInfo = {
      phase,
      stepIndex,
      command,
      status: 'running',
      startedAt: Date.now(),
    };
    extended.phaseHistory = [...(extended.phaseHistory ?? []), stepInfo];

    const phaseSteps = this.template?.phases[phase] ?? [];
    log.info(
      { sessionId: session.sessionId, phase, step: stepIndex, command },
      'Phase step resolved',
    );

    return {
      success: true,
      completed: false,
      command,
      phase,
      stepIndex,
      stepTotal: phaseSteps.length,
      session: getSession(session.sessionId),
    };
  }

  private moveToNextPhase(session: SessionState): PhaseStepResult {
    const extended = session as ExtendedSession;

    extended.currentPhaseIndex = (extended.currentPhaseIndex ?? 0) + 1;
    extended.currentStepIndex = 0;

    if (session.sessionId) {
      // persist via the store (in-memory set via getSession returns a reference)
      // re-read from store to get fresh ref
      const refreshed = getSession(session.sessionId) as ExtendedSession | undefined;
      if (refreshed) {
        Object.assign(refreshed, {
          currentPhaseIndex: extended.currentPhaseIndex,
          currentStepIndex: 0,
        });
      }
    }

    return this.resolveStep(session);
  }

  private advanceStep(sessionId: string, _output?: string): PhaseStepResult {
    const session = getSession(sessionId) as ExtendedSession;

    if (!session) {
      return { success: false, completed: false, error: 'Session not found' };
    }

    // Mark current step as completed in history
    if (session.phaseHistory && session.phaseHistory.length > 0) {
      const lastStep = session.phaseHistory[session.phaseHistory.length - 1];
      lastStep.status = 'completed';
      lastStep.completedAt = Date.now();
    }

    // Run pipeline quality gates on step output if CSV artifacts exist
    this.runPipelineGates(session).catch((err) => {
      log.warn({ err: String(err), sessionId }, 'Pipeline quality gates error (non-fatal)');
    });

    // Move to next step
    const phase = session.phaseOrder?.[session.currentPhaseIndex ?? 0];
    const phaseSteps = phase ? (this.template?.phases[phase] ?? []) : [];
    const nextStep = (session.currentStepIndex ?? 0) + 1;

    if (phase && nextStep < phaseSteps.length) {
      session.currentStepIndex = nextStep;
      return this.resolveStep(session);
    }

    // Current phase done — move to next phase
    return this.moveToNextPhase(session);
  }

  private handleFailure(sessionId: string, error?: string): PhaseStepResult {
    const session = getSession(sessionId) as ExtendedSession;

    if (!session) {
      return { success: false, completed: false, error: 'Session not found' };
    }

    // Mark current step as failed in history
    if (session.phaseHistory && session.phaseHistory.length > 0) {
      const lastStep = session.phaseHistory[session.phaseHistory.length - 1];
      lastStep.status = 'failed';
      lastStep.completedAt = Date.now();
      lastStep.error = error;
    }

    if (session.attempt < session.maxAttempts) {
      const retried = retrySession(sessionId);
      if (retried) {
        log.info(
          { sessionId, attempt: retried.attempt, phase: session.phaseOrder?.[session.currentPhaseIndex ?? 0], error },
          'Phase step retrying',
        );
        return {
          success: false,
          completed: false,
          error: error ?? 'Step failed, retrying',
          session: retried,
        };
      }
    }

    const failed = failSession(sessionId, error ?? 'Phase step failed after max retries');
    log.error(
      { sessionId, error: error ?? 'Phase step failed', attempt: session.attempt },
      'Phase step failed permanently',
    );

    return {
      success: false,
      completed: false,
      error: error ?? 'Phase step failed',
      session: failed,
    };
  }

  getExecutionResult(sessionId: string): {
    success: boolean;
    summary?: string;
    confidence?: string;
    error?: string;
    output?: string;
  } {
    const session = getSession(sessionId) as ExtendedSession | undefined;
    if (!session) {
      return { success: false, error: 'Session not found' };
    }

    const lastPhase = session.phaseHistory?.[session.phaseHistory.length - 1];
    const allCompleted = session.phaseHistory?.every((s) => s.status === 'completed') ?? false;

    let confidence = 'medium';
    if (session.status === 'completed') {
      confidence = allCompleted ? 'high' : 'medium';
    } else if (session.status === 'failed') {
      confidence = 'low';
    }

    return {
      success: session.status === 'completed',
      summary: lastPhase?.command ? `Phase "${lastPhase.phase}" completed` : 'Pipeline finished',
      confidence,
      error: session.error,
      output: lastPhase?.command,
    };
  }

  // ── Agent Confinement Enforcement ───────────────────────────────────────

  private checkBudget(sessionId: string, _stepCost?: number): boolean {
    const session = getSession(sessionId) as ExtendedSession | undefined;
    if (!session || !this.confinement.costBudget) return false;

    const maxTokens = this.confinement.costBudget.maxTokens;
    const currentTokens = session.cumulativeTokens ?? 0;

    return currentTokens >= maxTokens;
  }

  private checkLoop(sessionId: string, output: string): boolean {
    const session = getSession(sessionId) as ExtendedSession | undefined;
    if (!session) return false;

    const prevOutput = session.lastPhaseOutput;
    session.lastPhaseOutput = output;

    // No previous output means this is the first phase
    if (prevOutput === undefined) return false;

    return (
      this.confinement.loopDetectionEnabled &&
      output !== undefined &&
      output === prevOutput
    );
  }

  private recordAndCheckDeadEnd(sessionId: string, error: string): boolean {
    const session = getSession(sessionId) as ExtendedSession | undefined;
    if (!session) return false;

    const issueId = `${this.job.repoOwner}/${this.job.repoName}#${this.job.issueNumber}`;
    const signature = this.normalizeErrorSignature(error);

    let signatures = PipelineExecutor.errorSignatures.get(issueId);
    if (!signatures) {
      signatures = new Set();
      PipelineExecutor.errorSignatures.set(issueId, signatures);
    }

    if (signatures.has(signature)) {
      return true;
    }

    signatures.add(signature);
    return false;
  }

  private normalizeErrorSignature(error: string): string {
    return error
      .replace(/\d+/g, '0')
      .replace(/at \S+ \(\S+:\d+:\d+\)/g, 'at <location>')
      .replace(/node_modules\/\S+/g, 'node_modules/<pkg>')
      .trim();
  }

  private markBudgetExhausted(sessionId: string): PhaseStepResult {
    const session = getSession(sessionId) as ExtendedSession | undefined;
    if (session && session.phaseHistory && session.phaseHistory.length > 0) {
      const lastStep = session.phaseHistory[session.phaseHistory.length - 1];
      lastStep.status = 'budget_exhausted';
      lastStep.completedAt = Date.now();
    }

    log.warn({ sessionId, cumulativeTokens: session?.cumulativeTokens }, 'Phase skipped: BUDGET_EXHAUSTED');
    const failed = failSession(sessionId, 'BUDGET_EXHAUSTED: Token/cost budget exceeded');
    return {
      success: false,
      completed: false,
      error: 'BUDGET_EXHAUSTED: Token/cost budget exceeded',
      session: failed,
    };
  }

  private markPhaseStuck(sessionId: string): PhaseStepResult {
    const session = getSession(sessionId) as ExtendedSession | undefined;
    if (session && session.phaseHistory && session.phaseHistory.length > 0) {
      const lastStep = session.phaseHistory[session.phaseHistory.length - 1];
      lastStep.status = 'stuck';
      lastStep.completedAt = Date.now();
    }

    log.warn({ sessionId }, 'Phase detected as STUCK — output unchanged from previous phase');
    const failed = failSession(sessionId, 'STUCK: Phase output identical to previous phase — no progress');
    return {
      success: false,
      completed: false,
      error: 'STUCK: Phase output identical to previous phase — no progress',
      session: failed,
    };
  }

  private handleDeadEnd(sessionId: string, error: string): PhaseStepResult {
    const session = getSession(sessionId) as ExtendedSession | undefined;
    if (session && session.phaseHistory && session.phaseHistory.length > 0) {
      const lastStep = session.phaseHistory[session.phaseHistory.length - 1];
      lastStep.status = 'failed';
      lastStep.completedAt = Date.now();
      lastStep.error = error;
    }

    log.warn(
      { sessionId, error, issueId: `${this.job.repoOwner}/${this.job.repoName}#${this.job.issueNumber}` },
      'Dead-end detected — recurring error signature across pipeline runs',
    );
    const failed = failSession(
      sessionId,
      `DEAD_END: Recurring error signature detected: ${error}`,
    );
    return {
      success: false,
      completed: false,
      error: `DEAD_END: Recurring error signature detected: ${error}`,
      session: failed,
    };
  }

  private async runPipelineGates(session: ExtendedSession): Promise<void> {
    const pipelineRun = this.pipelineRun;
    if (!pipelineRun) return;

    const template = this.template;
    if (!template) return;

    const gatesConfig: GatesConfig = (template as unknown as Record<string, unknown>).gates as GatesConfig ?? {};
    const hasAnyGate = gatesConfig.schema || gatesConfig.rowCount || gatesConfig.nullRate || gatesConfig.metric;
    if (!hasAnyGate) return;

    const lastPhase = session.phaseHistory?.[session.phaseHistory.length - 1];
    if (!lastPhase) return;

    const stepMeta = lastPhase as unknown as Record<string, unknown>;

    const gateRunner = new GateRunner();
    const allResults: GateRunnerResult[] = [];

    const csvCandidates = [
      ...((template.phases?.main ?? []) as { command: string; session: string; output?: string }[]).map((s) => s.output),
      ...((template.phases?.post ?? []) as { command: string; session: string; output?: string }[]).map((s) => s.output),
      ...((template.phases?.final ?? []) as { command: string; session: string; output?: string }[]).map((s) => s.output),
    ].filter((x): x is string => !!x);

    const csvPaths = [...new Set(csvCandidates)];

    for (const csvPath of csvPaths) {
      const input: GateCheckInput = {
        csvPath,
        gates: gatesConfig,
        stepMeta,
      };
      try {
        const result = await gateRunner.checkAll(input);
        allResults.push(result);

        const metrics: Record<string, number> = {};
        for (const gateResult of result.results) {
          if (gateResult.verdict === 'pass' && gateResult.details) {
            for (const [key, value] of Object.entries(gateResult.details)) {
              if (typeof value === 'number') {
                metrics[`${gateResult.gate}.${key}`] = value;
              }
            }
          }
        }

        if (Object.keys(metrics).length > 0) {
          const chain = getPipelineVersionChain(pipelineRun.pipelineId);
          const prevMetrics = chain.length >= 2
            ? chain[chain.length - 2]?.metrics
            : undefined;

          if (prevMetrics) {
            for (const [key, val] of Object.entries(metrics)) {
              const prev = prevMetrics[key];
              if (prev !== undefined && prev !== 0) {
                const delta = ((val - prev) / prev) * 100;
                metrics[`${key}.vs_previous`] = val;
                metrics[`${key}.delta_pct`] = Math.round(delta * 100) / 100;
              }
            }
          }

          updatePipelineRunMetrics(pipelineRun.pipelineId, pipelineRun.version, metrics);
          session.metadata = {
            ...session.metadata,
            pipelineMetrics: metrics,
            pipelineVersion: pipelineRun.version,
          };
        }
      } catch (err) {
        log.warn({ err: String(err), csvPath }, 'Gate check failed for CSV output');
      }
    }

    const passedCount = allResults.filter((r) => r.passed).length;
    log.info(
      { passed: passedCount, total: allResults.length, pipelineId: pipelineRun.pipelineId },
      'Pipeline quality gates completed',
    );
  }

  private resolvePipelineConfig(): PipelineConfigRun {
    const pipelineId = `pipeline-${this.job.repoOwner}-${this.job.repoName}-${this.job.issueNumber}`;
    const config = resolveConfig(this.job.issueBody);
    const ticketId = String(this.job.issueNumber);
    const datasetHash = this.job.issueBody
      ? `sha256:${simpleHash(this.job.issueBody)}`
      : undefined;

    const run = createPipelineRun(pipelineId, config, ticketId, datasetHash);
    log.info(
      { pipelineId, version: run.version, config },
      'Pipeline config resolved and versioned',
    );
    return run;
  }
}

function buildContext(job: IssueJobData): Record<string, string> {
  return {
    'issue.number': String(job.issueNumber),
    'issue.title': job.issueTitle,
    'issue.body': job.issueBody ?? '',
    'issue.owner': job.repoOwner,
    'issue.repo': job.repoName,
    'issue.labels': job.labels?.join(',') ?? '',
    'repo.full': `${job.repoOwner}/${job.repoName}`,
  };
}

function buildPipelineContext(run: PipelineConfigRun): Record<string, string> {
  const cfg = run.configBlob;
  return {
    'pipeline.id': run.pipelineId,
    'pipeline.version': String(run.version),
    'config.version': String(run.version),
    'config.batch_size': String(cfg.batch_size),
    'config.learning_rate': String(cfg.learning_rate),
    'config.feature_set': cfg.feature_set,
    'config.dataset_hash': run.datasetHash ?? '',
  };
}

function simpleHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const chr = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}
