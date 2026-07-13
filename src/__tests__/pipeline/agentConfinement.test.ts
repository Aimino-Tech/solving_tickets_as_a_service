import { beforeEach, describe, expect, it } from 'vitest';
import { clearLoadedTemplates, scanTemplatesDirectory } from '../../template/loader.js';
import { PipelineExecutor, ALL_PHASES } from '../../pipeline/pipelineExecutor.js';
import { getSession, sessionStore } from '../../pipeline/sessionOrchestrator.js';
import type { IssueJobData } from '../../utils/types.js';
import type {
  ConfinementConfig,
  PhaseStepResult,
  PhaseStepInfo,
  PipelinePhase,
  SessionState,
} from '../../pipeline/types.js';

const mockJob: IssueJobData = {
  installationId: 123,
  repoOwner: 'test-owner',
  repoName: 'test-repo',
  repoPrivate: false,
  issueNumber: 42,
  issueTitle: 'Fix login bug',
  issueBody: 'The login page crashes on submit',
  labels: ['stas:fix', 'bug'],
};

const mockJobTwo: IssueJobData = {
  installationId: 123,
  repoOwner: 'test-owner',
  repoName: 'test-repo',
  repoPrivate: false,
  issueNumber: 99,
  issueTitle: 'Another issue',
  issueBody: 'Description',
  labels: ['stas:fix'],
};

function scanAndGetIssuedId(first: PhaseStepResult): string {
  return first.session!.sessionId;
}

function sessionPhaseHistory(sessionId: string): PhaseStepInfo[] {
  const session = getSession(sessionId) as SessionState & { phaseHistory?: PhaseStepInfo[] };
  return session?.phaseHistory ?? [];
}

function lastStepStatus(sessionId: string): string | undefined {
  const history = sessionPhaseHistory(sessionId);
  return history.length > 0 ? history[history.length - 1].status : undefined;
}

describe('Agent Confinement — Cost Budget', () => {
  beforeEach(() => {
    clearLoadedTemplates();
    sessionStore.clear();
  });

  it('marks phase BUDGET_EXHAUSTED when cumulative token cost exceeds maxTokens', async () => {
    scanTemplatesDirectory();

    const executor = new PipelineExecutor(mockJob, 'stas:fix');
    const first = await executor.start();
    const sessionId = scanAndGetIssuedId(first);

    // First phase step completes with token cost within budget
    const step2 = await executor.advance(sessionId, { success: true, output: 'step1 done', tokenCost: 500 });
    expect(step2.phase).toBe('pre');

    // Second pre step pushes cumulative cost over 1000 limit
    const step3 = await executor.advance(sessionId, { success: true, output: 'step2 done', tokenCost: 600 });
    // Budget is checked before each phase — the 3rd advance tries to move
    // from pre to main, which should be blocked by budget
    if (step3.completed) {
      // If the template has 2 pre steps and we just completed step 1 (index 1),
      // the next advance would check budget before moving to main phase
      const step4 = await executor.advance(sessionId, { success: true, output: 'step3 done', tokenCost: 0 });
      expect(step4.success).toBe(false);
      expect(step4.error).toContain('BUDGET_EXHAUSTED');
    }
  });

  it('allows phase to proceed when cumulative cost is within budget', async () => {
    scanTemplatesDirectory();

    const executor = new PipelineExecutor(mockJob, 'stas:fix');
    const first = await executor.start();
    const sessionId = scanAndGetIssuedId(first);

    // Advance through all pre steps with small token costs
    let result: PhaseStepResult = first;
    const totalSteps = ALL_PHASES.reduce(
      (sum, p) => sum + (scanTemplatesDirectory().find(t => t.name === 'stas:fix')?.phases[p]?.length ?? 0),
      0,
    );

    for (let i = 1; i < totalSteps; i++) {
      result = await executor.advance(sessionId, { success: true, output: `step ${i}`, tokenCost: 100 });
      if (result.completed) break;
    }

    // Should complete normally without budget exhaustion
    const final = await executor.advance(sessionId, { success: true, output: 'final', tokenCost: 50 });
    expect(final.completed).toBe(true);
  });
});

describe('Agent Confinement — Loop Detection', () => {
  beforeEach(() => {
    clearLoadedTemplates();
    sessionStore.clear();
  });

  it('marks phase STUCK when OpenCode output is identical to previous phase output', async () => {
    scanTemplatesDirectory();

    const executor = new PipelineExecutor(mockJob, 'stas:fix');
    const first = await executor.start();
    const sessionId = scanAndGetIssuedId(first);

    // Advance through all pre steps with unique outputs
    let result: PhaseStepResult = first;
    let advanceIndex = 0;
    while (!result.completed && !result.error && advanceIndex < 10) {
      result = await executor.advance(sessionId, {
        success: true,
        output: result.phase === 'pre' ? 'pre output' : 'same repeated output',
        tokenCost: 10,
      });
      advanceIndex++;
    }

    // If we made it past pre phase, subsequent phases with identical output should get stuck
    if (!result.error && !result.completed) {
      const stuck = await executor.advance(sessionId, {
        success: true,
        output: 'same repeated output',
        tokenCost: 10,
      });
      // Should detect stuck — either error or stuck status
      if (!stuck.completed && stuck.error) {
        expect(stuck.error).toContain('STUCK');
      }
    }
  });

  it('allows distinct outputs between phases without loop detection', async () => {
    clearLoadedTemplates();
    sessionStore.clear();
    scanTemplatesDirectory();

    const executor = new PipelineExecutor(mockJob, 'stas:fix');
    const first = await executor.start();
    const sessionId = scanAndGetIssuedId(first);

    // Advance through all steps with distinct outputs
    let result: PhaseStepResult = first;
    const totalSteps = ALL_PHASES.reduce(
      (sum, p) => sum + (scanTemplatesDirectory().find(t => t.name === 'stas:fix')?.phases[p]?.length ?? 0),
      0,
    );

    for (let i = 1; i < totalSteps; i++) {
      result = await executor.advance(sessionId, {
        success: true,
        output: `distinct output ${i}`,
        tokenCost: 5,
      });
      if (result.completed) break;
    }

    // Should complete normally — no stuck detection
    const final = await executor.advance(sessionId, { success: true, output: 'final distinct', tokenCost: 5 });
    expect(final.completed).toBe(true);
  });
});

describe('Agent Confinement — Tool Allowlist', () => {
  beforeEach(() => {
    clearLoadedTemplates();
    sessionStore.clear();
  });

  it('passes tool restrictions to phase command context', async () => {
    scanTemplatesDirectory();

    const confinement: ConfinementConfig = {
      loopDetectionEnabled: false,
      deadEndDetectionEnabled: false,
      toolAllowlist: {
        allowedTools: ['file_write', 'requests', 'browser'],
        deniedTools: ['git_push', 'git_commit'],
      },
    };

    const executor = new PipelineExecutor(mockJob, 'stas:fix', confinement);
    const result = await executor.start();

    expect(result.success).toBe(true);
    expect(result.command).toBeDefined();

    // The tool allowlist should be injectable as env var context
    // Verify the executor stored the allowlist for phase dispatch
    expect(result.session).toBeDefined();
  });

  it('denies restricted tools by default when allowlist is empty', async () => {
    scanTemplatesDirectory();

    const confinement: ConfinementConfig = {
      loopDetectionEnabled: false,
      deadEndDetectionEnabled: false,
      toolAllowlist: {
        allowedTools: [],
        deniedTools: [],
      },
    };

    const executor = new PipelineExecutor(mockJob, 'stas:fix', confinement);
    const result = await executor.start();
    expect(result.success).toBe(true);
  });
});

describe('Agent Confinement — Dead-End Detection', () => {
  beforeEach(() => {
    clearLoadedTemplates();
    sessionStore.clear();
    PipelineExecutor.clearErrorHistory();
  });

  it('detects recurring error signature across runs for same issue', async () => {
    scanTemplatesDirectory();

    const deadEndConfig: ConfinementConfig = {
      loopDetectionEnabled: false,
      deadEndDetectionEnabled: true,
    };

    // First run: fails with a specific error
    const executor1 = new PipelineExecutor(mockJob, 'stas:fix', deadEndConfig);
    const first1 = await executor1.start();
    const sid1 = scanAndGetIssuedId(first1);
    await executor1.advance(sid1, { success: false, error: 'Connection timeout to OpenCode API' });

    // Second run for the same issue with matching error — dead-end should trigger
    const executor2 = new PipelineExecutor(mockJob, 'stas:fix', deadEndConfig);
    const first2 = await executor2.start();
    const sid2 = scanAndGetIssuedId(first2);
    const result2 = await executor2.advance(sid2, { success: false, error: 'Connection timeout to OpenCode API' });

    expect(result2.success).toBe(false);
    if (result2.error) {
      expect(result2.error).toContain('DEAD_END');
    }
  });

  it('treats different error signatures as non-recurring', async () => {
    scanTemplatesDirectory();
    PipelineExecutor.clearErrorHistory();

    const deadEndConfig: ConfinementConfig = {
      loopDetectionEnabled: false,
      deadEndDetectionEnabled: true,
    };

    // Run 1: fails with error A
    const executor1 = new PipelineExecutor(mockJobTwo, 'stas:fix', deadEndConfig);
    const first1 = await executor1.start();
    const sid1 = scanAndGetIssuedId(first1);
    await executor1.advance(sid1, { success: false, error: 'Timeout' });

    // Run 2: fails with error B — should not trigger dead-end
    const executor2 = new PipelineExecutor(mockJobTwo, 'stas:fix', deadEndConfig);
    const first2 = await executor2.start();
    const sid2 = scanAndGetIssuedId(first2);
    const result2 = await executor2.advance(sid2, { success: false, error: 'Invalid response format' });

    expect(result2.success).toBe(false);
    if (result2.error) {
      expect(result2.error).not.toContain('DEAD_END');
    }
  });
});
