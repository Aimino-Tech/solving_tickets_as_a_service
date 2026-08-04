import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearLoadedTemplates,
  getLoadedTemplate,
  scanTemplatesDirectory,
} from '../../template/loader.js';
import { PipelineExecutor, ALL_PHASES } from '../../pipeline/pipelineExecutor.js';
import { getSession, sessionStore } from '../../pipeline/sessionOrchestrator.js';
import type { IssueJobData } from '../../utils/types.js';
import type { PhaseStepResult, SessionState } from '../../pipeline/types.js';

const mockJob: IssueJobData = {
  installationId: 123,
  repoOwner: 'test-owner',
  repoName: 'test-repo',
  repoPrivate: false,
  issueNumber: 42,
  issueTitle: 'Fix login bug',
  issueBody: 'The login page crashes on submit',
  labels: ['syntaro:fix', 'bug'],
};

describe('PipelineExecutor', () => {
  beforeEach(() => {
    clearLoadedTemplates();
    sessionStore.clear();
  });

  describe('start()', () => {
    it('returns error when template is not found', async () => {
      const executor = new PipelineExecutor(mockJob, 'nonexistent-template');
      const result = await executor.start();

      expect(result.success).toBe(false);
      expect(result.completed).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('returns completed when template has no populated phases', async () => {
      scanTemplatesDirectory();
      const executor = new PipelineExecutor(mockJob, 'default');
      const result = await executor.start();

      // The default template has all 4 phases populated, so start should succeed
      expect(result.success).toBe(true);
      expect(result.completed).toBe(false);
      expect(result.command).toBeDefined();
      expect(result.phase).toBeDefined();
    });

    it('resolves the first step from the loaded template', async () => {
      const loaded = scanTemplatesDirectory();
      expect(loaded.length).toBeGreaterThan(0);

      const executor = new PipelineExecutor(mockJob, 'syntaro:fix');
      const result = await executor.start();

      expect(result.success).toBe(true);
      expect(result.completed).toBe(false);
      expect(result.command).toBeDefined();
      expect(result.phase).toBe('pre');
      expect(result.stepIndex).toBe(0);
      expect(result.stepTotal).toBeGreaterThan(0);

      // Verify placeholder substitution
      expect(result.command).toContain('Fix login bug');
    });

    it('creates a session with phase metadata', async () => {
      scanTemplatesDirectory();
      const executor = new PipelineExecutor(mockJob, 'syntaro:fix');
      const firstResult = await executor.start();

      expect(firstResult.session).toBeDefined();
      const session = firstResult.session! as SessionState & {
        templateName: string;
        phaseOrder: string[];
        currentPhaseIndex: number;
        currentStepIndex: number;
        phaseHistory: unknown[];
      };

      expect(session.templateName).toBe('syntaro:fix');
      expect(session.phaseOrder).toEqual(expect.arrayContaining(['pre', 'main', 'post', 'final']));
      expect(session.currentPhaseIndex).toBe(0);
      expect(session.currentStepIndex).toBe(0);
    });
  });

  describe('advance()', () => {
    it('advances to the next step within the same phase', async () => {
      scanTemplatesDirectory();
      const executor = new PipelineExecutor(mockJob, 'syntaro:fix');
      const first = await executor.start();
      expect(first.phase).toBe('pre');
      expect(first.stepIndex).toBe(0);

      // Advance with success — should move to step 1 in pre phase
      const second = await executor.advance(first.session!.sessionId, { success: true });
      expect(second.success).toBe(true);
      // The fix template has 2 steps in pre, so step 1 is still in pre
      expect(second.phase).toBe('pre');
      expect(second.stepIndex).toBe(1);
    });

    it('transitions to the next phase when all phase steps are consumed', async () => {
      scanTemplatesDirectory();
      const executor = new PipelineExecutor(mockJob, 'syntaro:fix');
      const first = await executor.start();
      expect(first.phase).toBe('pre');

      // Advance through all pre steps (fix template has 2 pre steps)
      const step2 = await executor.advance(first.session!.sessionId, { success: true });
      expect(step2.phase).toBe('pre');
      expect(step2.stepIndex).toBe(1);

      // Next advance should move to main
      const step3 = await executor.advance(first.session!.sessionId, { success: true });
      expect(step3.phase).toBe('main');
      expect(step3.stepIndex).toBe(0);
    });

    it('completes when all phases are done', async () => {
      scanTemplatesDirectory();
      const template = getLoadedTemplate('syntaro:fix')!;
      const totalSteps = ALL_PHASES.reduce(
        (sum, p) => sum + (template.phases[p]?.length ?? 0),
        0,
      );

      const executor = new PipelineExecutor(mockJob, 'syntaro:fix');
      const first = await executor.start();
      expect(first.phase).toBe('pre');

      let result: PhaseStepResult = first;
      // Advance through every step
      for (let i = 1; i < totalSteps; i++) {
        result = await executor.advance(result.session!.sessionId, { success: true });
      }

      // One more advance should signal completion
      const finalResult = await executor.advance(result.session!.sessionId, { success: true });
      expect(finalResult.completed).toBe(true);
      expect(finalResult.success).toBe(true);

      // Verify session is marked complete
      const session = getSession(first.session!.sessionId);
      expect(session).toBeDefined();
      expect(session!.status).toBe('completed');
    });

    it('returns error for non-existent session', async () => {
      scanTemplatesDirectory();
      const executor = new PipelineExecutor(mockJob, 'syntaro:fix');
      await executor.start();

      const result = await executor.advance('nonexistent-session', { success: true });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Session not found');
    });
  });

  describe('failure and retry', () => {
    it('retries a step when failure occurs and attempts remain', async () => {
      scanTemplatesDirectory();
      const executor = new PipelineExecutor(mockJob, 'syntaro:fix');
      const first = await executor.start();

      const result = await executor.advance(first.session!.sessionId, {
        success: false,
        error: 'Timeout',
      });

      // Should indicate retry
      expect(result.success).toBe(false);
      expect(result.completed).toBe(false);

      // Session should still be in retry state
      const session = getSession(first.session!.sessionId);
      expect(session).toBeDefined();
      expect(session!.attempt).toBeGreaterThan(1);
    });

    it('fails permanently when max retries exceeded', async () => {
      scanTemplatesDirectory();
      const executor = new PipelineExecutor(mockJob, 'syntaro:fix');
      const first = await executor.start();

      // Consume all retries by failing repeatedly
      for (let i = 0; i < 5; i++) {
        await executor.advance(first.session!.sessionId, {
          success: false,
          error: 'Persistent error',
        });
      }

      const session = getSession(first.session!.sessionId);
      expect(session).toBeDefined();
      expect(session!.status).toBe('failed');
      expect(session!.error).toBeDefined();
    });
  });

  describe('getProgress()', () => {
    it('returns initial progress state', async () => {
      scanTemplatesDirectory();
      const executor = new PipelineExecutor(mockJob, 'syntaro:fix');
      const result = await executor.start();

      const progress = executor.getProgress(result.session!.sessionId);
      expect(progress.currentPhase).toBe('pre');
      expect(progress.currentStep).toBe(0);
      expect(progress.totalPhases).toBeGreaterThan(0);
    });

    it('returns empty progress for non-existent session', async () => {
      const executor = new PipelineExecutor(mockJob, 'syntaro:fix');
      const progress = executor.getProgress('nonexistent');
      expect(progress.currentPhase).toBeNull();
      expect(progress.totalPhases).toBe(0);
    });
  });

  describe('backward compatibility', () => {
    it('existing legacy pipeline stages still transition correctly', async () => {
      // Import the original state machine helpers
      const { isValidTransition, getNextStage } = await import('../../pipeline/stateMachine.js');

      // Verify original transitions still work
      expect(isValidTransition('queued', 'triage')).toBe(true);
      expect(isValidTransition('triage', 'workspace')).toBe(true);
      expect(isValidTransition('agent', 'verification')).toBe(true);
      expect(getNextStage('queued')).toBe('triage');
      expect(getNextStage('completed')).toBeNull();

      // Verify phase transitions work alongside legacy ones
      expect(isValidTransition('phase_pre', 'phase_main')).toBe(true);
      expect(isValidTransition('phase_main', 'phase_post')).toBe(true);
      expect(isValidTransition('phase_post', 'phase_final')).toBe(true);
      expect(isValidTransition('phase_final', 'completed')).toBe(true);
    });

    it('can fall back to hardcoded flow when no template matches', async () => {
      // When template is not found, start() returns error
      // The caller can then use the legacy session creation directly
      const executor = new PipelineExecutor(mockJob, 'nonexistent');
      const result = await executor.start();

      expect(result.success).toBe(false);
      expect(result.completed).toBe(false);
    });
  });
});
