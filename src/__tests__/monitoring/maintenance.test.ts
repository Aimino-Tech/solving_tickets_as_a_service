import { describe, it, expect, beforeEach } from 'vitest';
import {
  setMaintenanceMode,
  isMaintenanceMode,
  getMaintenanceInfo,
  maintenanceMiddleware,
} from '../../monitoring/maintenance.js';

beforeEach(() => {
  setMaintenanceMode(false);
});

function callMiddleware(req: { method: string; path: string }, res: { status: (code: number) => { json: (body: Record<string, unknown>) => void } }) {
  let statusCode = 200;
  let body: Record<string, unknown> | undefined;
  const status = (code: number) => {
    statusCode = code;
    return {
      json: (b: Record<string, unknown>) => {
        body = b;
      },
    };
  };
  const mockRes = { status } as typeof res;
  let nextCalled = false;
  maintenanceMiddleware(req as never, mockRes as never, () => {
    nextCalled = true;
  });
  return { statusCode, body, nextCalled };
}

describe('maintenance mode (AIM-4496)', () => {
  it('passes through when maintenance is off', () => {
    const result = callMiddleware({ method: 'GET', path: '/api/v1/runs' }, { status: () => ({ json: () => {} }) });
    expect(result.nextCalled).toBe(true);
  });

  it('returns 503 when maintenance is on', () => {
    setMaintenanceMode(true, 'Scheduled upgrade');
    const result = callMiddleware({ method: 'GET', path: '/api/v1/runs' }, { status: () => ({ json: () => {} }) });
    expect(result.nextCalled).toBe(false);
    expect(result.statusCode).toBe(503);
    expect(result.body?.error?.code).toBe('MAINTENANCE_MODE');
  });

  it('lets /health through during maintenance', () => {
    setMaintenanceMode(true);
    const result = callMiddleware({ method: 'GET', path: '/health' }, { status: () => ({ json: () => {} }) });
    expect(result.nextCalled).toBe(true);
  });

  it('tracks state via getters', () => {
    expect(isMaintenanceMode()).toBe(false);
    setMaintenanceMode(true, 'Upgrade in progress');
    expect(isMaintenanceMode()).toBe(true);
    expect(getMaintenanceInfo()).toEqual({ active: true, message: 'Upgrade in progress' });
    setMaintenanceMode(false);
    expect(getMaintenanceInfo().active).toBe(false);
  });
});
