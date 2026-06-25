import { Router, type Request, type Response } from 'express';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'routes:pipeline' });

const router = Router();

interface PipelineState {
  status: 'running' | 'completed' | 'failed' | 'rework' | 'cancelled';
  currentStage: string;
  attempt: number;
  progress: Record<string, string>;
  resultUrl?: string;
  error?: string;
}

const pipelineStates = new Map<string, PipelineState>();

router.get('/:issueId', (req: Request, res: Response) => {
  const { issueId } = req.params;
  const state = pipelineStates.get(issueId);
  if (!state) {
    res.status(404).json({ error: 'Pipeline not found' });
    return;
  }
  res.json({ issueId, ...state });
});

router.post('/:issueId/cancel', (req: Request, res: Response) => {
  const { issueId } = req.params;
  const state = pipelineStates.get(issueId);
  if (!state) {
    res.status(404).json({ error: 'Pipeline not found' });
    return;
  }
  state.status = 'cancelled';
  pipelineStates.set(issueId, state);
  log.info({ issueId }, 'Pipeline cancelled');
  res.json({ status: 'cancelled' });
});

export function updatePipelineState(
  issueId: string,
  updates: Partial<PipelineState>,
): void {
  const existing = pipelineStates.get(issueId) ?? {
    status: 'running',
    currentStage: '',
    attempt: 0,
    progress: {},
  };
  pipelineStates.set(issueId, { ...existing, ...updates });
}

export default router;
