/**
 * Unit tests for pipelineRunStore — PipelineRunStore class.
 *
 * Strategy: mock queryWithRetry to control all DB interactions.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock DB connection
const mockQueryWithRetry = vi.fn();
vi.mock('../db/connection.js', () => ({
  queryWithRetry: mockQueryWithRetry,
}));

vi.mock('../utils/logger.js', () => ({
  rootLogger: { child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })) },
}));

describe('PipelineRunStore', () => {
  let store: import('./pipelineRunStore.js').PipelineRunStore;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('./pipelineRunStore.js');
    store = new mod.PipelineRunStore();
  });

  // -----------------------------------------------------------------------
  // createRun
  // -----------------------------------------------------------------------

  describe('createRun', () => {
    it('creates a new pipeline run with default status', async () => {
      const fakeRow = {
        id: 1,
        tenant_id: 'tenant-1',
        issue_id: 'issue-1',
        status: 'pending',
        agent_type: 'claude',
        stages: '[]',
        error: '',
        started_at: null,
        completed_at: null,
        created_at: '2026-06-25T10:00:00.000Z',
        updated_at: '2026-06-25T10:00:00.000Z',
      };
      mockQueryWithRetry.mockResolvedValue({ rows: [fakeRow] });

      const run = await store.createRun({ tenantId: 'tenant-1', issueId: 'issue-1' });

      expect(run.id).toBe(1);
      expect(run.tenantId).toBe('tenant-1');
      expect(run.status).toBe('pending');
      expect(mockQueryWithRetry).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO pipeline_runs'),
        ['tenant-1', 'issue-1', 'pending', '', '[]', '', null],
      );
    });

    it('creates a run with all optional fields', async () => {
      const fakeRow = {
        id: 2,
        tenant_id: 'tenant-2',
        issue_id: 'issue-2',
        status: 'running',
        agent_type: 'gpt-5',
        stages: JSON.stringify([{ stageName: 'investigate', status: 'running' }]),
        error: '',
        started_at: '2026-06-25T09:00:00.000Z',
        completed_at: null,
        created_at: '2026-06-25T09:00:00.000Z',
        updated_at: '2026-06-25T09:00:00.000Z',
      };
      mockQueryWithRetry.mockResolvedValue({ rows: [fakeRow] });

      const run = await store.createRun({
        tenantId: 'tenant-2',
        issueId: 'issue-2',
        status: 'running',
        agentType: 'gpt-5',
        stages: [{ runId: 2, tenantId: 'tenant-2', stageName: 'investigate', status: 'running' }],
        startedAt: '2026-06-25T09:00:00.000Z',
      });

      expect(run.agentType).toBe('gpt-5');
      expect(run.status).toBe('running');
    });
  });

  // -----------------------------------------------------------------------
  // updateRun / completeRun
  // -----------------------------------------------------------------------

  describe('updateRun', () => {
    it('updates status and returns updated run', async () => {
      const fakeRow = {
        id: 1,
        tenant_id: 't1',
        issue_id: 'i1',
        status: 'completed',
        agent_type: '',
        stages: '[]',
        error: '',
        started_at: null,
        completed_at: '2026-06-25T11:00:00.000Z',
        created_at: '2026-06-25T10:00:00.000Z',
        updated_at: '2026-06-25T11:00:00.000Z',
      };
      mockQueryWithRetry.mockResolvedValue({ rows: [fakeRow] });

      const result = await store.updateRun(1, { status: 'completed' });
      expect(result?.status).toBe('completed');
    });

    it('returns undefined when no updates provided', async () => {
      const result = await store.updateRun(1, {});
      expect(result).toBeUndefined();
    });
  });

  describe('completeRun', () => {
    it('marks run as completed with optional error', async () => {
      mockQueryWithRetry.mockResolvedValue({
        rows: [{ id: 1, tenant_id: 't1', issue_id: 'i1', status: 'completed', agent_type: '', stages: '[]', error: '', started_at: null, completed_at: '2026-06-25T11:00:00.000Z', created_at: '2026-06-25T10:00:00.000Z', updated_at: '2026-06-25T11:00:00.000Z' }],
      });

      const result = await store.completeRun(1, 'completed');
      expect(result?.status).toBe('completed');
      expect(result?.completedAt).toBeTruthy();
    });
  });

  // -----------------------------------------------------------------------
  // getRunById
  // -----------------------------------------------------------------------

  describe('getRunById', () => {
    it('returns run when found', async () => {
      mockQueryWithRetry.mockResolvedValue({
        rows: [{ id: 1, tenant_id: 't1', issue_id: 'i1', status: 'running', agent_type: '', stages: '[]', error: '', started_at: null, completed_at: null, created_at: '2026-06-25T10:00:00.000Z', updated_at: '2026-06-25T10:00:00.000Z' }],
      });

      const run = await store.getRunById(1);
      expect(run?.id).toBe(1);
      expect(run?.status).toBe('running');
    });

    it('returns undefined when not found', async () => {
      mockQueryWithRetry.mockResolvedValue({ rows: [] });
      const run = await store.getRunById(999);
      expect(run).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // queryRuns
  // -----------------------------------------------------------------------

  describe('queryRuns', () => {
    it('returns paginated results with total count', async () => {
      mockQueryWithRetry
        .mockResolvedValueOnce({ rows: [{ count: '1' }] }) // count
        .mockResolvedValueOnce({
          rows: [{ id: 1, tenant_id: 't1', issue_id: 'i1', status: 'completed', agent_type: 'claude', stages: '[]', error: '', started_at: null, completed_at: null, created_at: '2026-06-25T10:00:00.000Z', updated_at: '2026-06-25T10:00:00.000Z' }],
        }); // data

      const result = await store.queryRuns({ tenantId: 't1', limit: 10 });
      expect(result.total).toBe(1);
      expect(result.runs).toHaveLength(1);
      expect(result.runs[0].tenantId).toBe('t1');
    });

    it('applies all filters correctly', async () => {
      mockQueryWithRetry
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [] });

      await store.queryRuns({
        tenantId: 't1',
        status: 'failed',
        agentType: 'gpt-5',
        issueId: 'iss-42',
        dateFrom: '2026-01-01T00:00:00Z',
        dateTo: '2026-06-30T23:59:59Z',
      });

      const firstCall = mockQueryWithRetry.mock.calls[0];
      expect(firstCall[0]).toContain('tenant_id');
      expect(firstCall[0]).toContain('status');
      expect(firstCall[0]).toContain('agent_type');
      expect(firstCall[0]).toContain('issue_id');
      expect(firstCall[0]).toContain('created_at >=');
      expect(firstCall[0]).toContain('created_at <=');
    });

    it('returns empty when no results', async () => {
      mockQueryWithRetry
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await store.queryRuns({ tenantId: 'nonexistent' });
      expect(result.total).toBe(0);
      expect(result.runs).toHaveLength(0);
    });

    it('enforces max page size', async () => {
      mockQueryWithRetry
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await store.queryRuns({ limit: 999 });
      expect(result.limit).toBeLessThanOrEqual(100);
    });
  });

  // -----------------------------------------------------------------------
  // recordStageEvent
  // -----------------------------------------------------------------------

  describe('recordStageEvent', () => {
    it('inserts a stage event record', async () => {
      const fakeEvent = {
        id: 1,
        run_id: 1,
        tenant_id: 't1',
        stage_name: 'investigate',
        status: 'running',
        started_at: null,
        completed_at: null,
        duration_ms: 0,
        output: '',
        error: '',
        metadata: '{}',
        created_at: '2026-06-25T10:00:00.000Z',
      };
      mockQueryWithRetry.mockResolvedValue({ rows: [fakeEvent] });

      const event = await store.recordStageEvent({
        runId: 1,
        tenantId: 't1',
        stageName: 'investigate',
        status: 'running',
      });

      expect(event.stage_name).toBe('investigate');
      expect(event.tenant_id).toBe('t1');
    });
  });

  describe('getStageEvents', () => {
    it('returns stage events ordered by creation time', async () => {
      mockQueryWithRetry.mockResolvedValue({
        rows: [
          { id: 1, run_id: 1, tenant_id: 't1', stage_name: 'investigate', status: 'completed', started_at: null, completed_at: null, duration_ms: 0, output: '', error: '', metadata: '{}', created_at: '2026-06-25T10:00:00.000Z' },
          { id: 2, run_id: 1, tenant_id: 't1', stage_name: 'fix', status: 'running', started_at: null, completed_at: null, duration_ms: 0, output: '', error: '', metadata: '{}', created_at: '2026-06-25T10:05:00.000Z' },
        ],
      });

      const events = await store.getStageEvents(1);
      expect(events).toHaveLength(2);
      expect(events[0].stage_name).toBe('investigate');
    });
  });

  // -----------------------------------------------------------------------
  // enforceRetention
  // -----------------------------------------------------------------------

  describe('enforceRetention', () => {
    it('deletes runs older than retention days and returns count', async () => {
      mockQueryWithRetry.mockResolvedValue({ rows: [{ deleted: '5' }] });

      const count = await store.enforceRetention(90);
      expect(count).toBe(5);
    });

    it('returns 0 when no old runs exist', async () => {
      mockQueryWithRetry.mockResolvedValue({ rows: [{ deleted: '0' }] });
      const count = await store.enforceRetention(90);
      expect(count).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // exportToCSV
  // -----------------------------------------------------------------------

  describe('exportToCSV', () => {
    it('generates CSV with header and data rows', async () => {
      mockQueryWithRetry
        .mockResolvedValueOnce({ rows: [{ count: '1' }] })
        .mockResolvedValueOnce({
          rows: [{
            id: 1,
            tenant_id: 't1',
            issue_id: 'i1',
            status: 'completed',
            agent_type: 'claude',
            stages: JSON.stringify([{ stageName: 'investigate' }]),
            error: '',
            started_at: null,
            completed_at: null,
            created_at: '2026-06-25T10:00:00.000Z',
            updated_at: '2026-06-25T10:00:00.000Z',
          }],
        });

      const csv = await store.exportToCSV({ tenantId: 't1' });
      expect(csv).toContain('ID,Tenant ID,Issue ID,Status');
      expect(csv).toContain('1,t1,i1,completed');
    });

    it('escapes special characters in CSV', async () => {
      mockQueryWithRetry
        .mockResolvedValueOnce({ rows: [{ count: '1' }] })
        .mockResolvedValueOnce({
          rows: [{
            id: 2,
            tenant_id: 't1',
            issue_id: 'issue-1',
            status: 'failed',
            agent_type: 'gpt-5',
            stages: '[]',
            error: 'timeout, connection refused',
            started_at: null,
            completed_at: null,
            created_at: '2026-06-25T10:00:00.000Z',
            updated_at: '2026-06-25T10:00:00.000Z',
          }],
        });

      const csv = await store.exportToCSV();
      expect(csv).toContain('"timeout, connection refused"');
    });
  });

  // -----------------------------------------------------------------------
  // getStats
  // -----------------------------------------------------------------------

  describe('getStats', () => {
    it('returns aggregated statistics', async () => {
      mockQueryWithRetry.mockResolvedValue({
        rows: [{
          total_runs: '10',
          by_status: JSON.stringify({ completed: '6', failed: '3', cancelled: '1' }),
          by_agent_type: JSON.stringify({ claude: '7', 'gpt-5': '3' }),
          success_rate: '0.6000',
          avg_duration_ms: '45000',
          total_errors: '3',
        }],
      });

      const stats = await store.getStats('t1');
      expect(stats.total).toBe(10);
      expect(stats.byStatus.completed).toBe(6);
      expect(stats.byStatus.failed).toBe(3);
      expect(stats.byAgentType.claude).toBe(7);
      expect(stats.successRate).toBe(0.6);
      expect(stats.avgDurationMs).toBe(45000);
      expect(stats.totalErrors).toBe(3);
      expect(stats.retentionDays).toBe(90);
    });

    it('returns empty stats when no runs exist', async () => {
      mockQueryWithRetry.mockResolvedValue({
        rows: [{
          total_runs: '0',
          by_status: '{}',
          by_agent_type: '{}',
          success_rate: '0',
          avg_duration_ms: '0',
          total_errors: '0',
        }],
      });

      const stats = await store.getStats();
      expect(stats.total).toBe(0);
      expect(Object.keys(stats.byStatus)).toHaveLength(0);
    });
  });
});
