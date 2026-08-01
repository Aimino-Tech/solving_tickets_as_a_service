import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../../config.js';
import { maintenanceMode } from '../../middleware/maintenance.js';

vi.mock('../../config.js', () => ({
  config: { maintenanceMode: true },
}));

describe('maintenance mode middleware', () => {
  const mockReq = (path: string) => ({ path, method: 'GET' }) as any;
  const mockRes = () => ({
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
  });
  const next = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (config as any).maintenanceMode = true;
  });

  it('returns 503 with Retry-After for regular API paths', () => {
    const res = mockRes();
    maintenanceMode(mockReq('/api/v1/runs'), res as any, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '3600');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('maintenance') }));
    expect(next).not.toHaveBeenCalled();
  });

  it('passes through allowlisted health paths', () => {
    const res = mockRes();
    maintenanceMode(mockReq('/healthz'), res as any, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('passes through webhook paths', () => {
    const res = mockRes();
    maintenanceMode(mockReq('/webhook/github'), res as any, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('passes through monitoring and status paths', () => {
    const res = mockRes();
    maintenanceMode(mockReq('/api/v1/monitoring/status'), res as any, next);
    expect(next).toHaveBeenCalled();

    vi.clearAllMocks();
    maintenanceMode(mockReq('/api/v1/status'), res as any, next);
    expect(next).toHaveBeenCalled();
  });

  it('never blocks when maintenance mode is disabled', () => {
    (config as any).maintenanceMode = false;
    const res = mockRes();
    maintenanceMode(mockReq('/api/v1/runs'), res as any, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
