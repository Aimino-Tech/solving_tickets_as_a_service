import { getWorkerHeartbeatStatus } from '../monitoring/alerting.js';

export interface WorkersHealthReport {
  status: 'ok' | 'degraded';
  totalWorkers: number;
  aliveWorkers: number;
  deadWorkers: number;
  workers: Array<{
    workerId: string;
    lastHeartbeat: string;
    isAlive: boolean;
    secondsSinceHeartbeat: number;
  }>;
  timestamp: string;
}

export function getWorkersHealth(): WorkersHealthReport {
  const workers = getWorkerHeartbeatStatus();
  const aliveWorkers = workers.filter((w) => w.isAlive).length;
  const deadWorkers = workers.length - aliveWorkers;

  return {
    status: workers.length === 0 ? 'ok' : deadWorkers > 0 ? 'degraded' : 'ok',
    totalWorkers: workers.length,
    aliveWorkers,
    deadWorkers,
    workers,
    timestamp: new Date().toISOString(),
  };
}
