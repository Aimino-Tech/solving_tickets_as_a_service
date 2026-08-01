import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'maintenance-mode' });

let maintenanceActive = false;
let maintenanceMessage = 'Under maintenance';

export function setMaintenanceMode(active: boolean, message?: string): void {
  maintenanceActive = active;
  if (message !== undefined) maintenanceMessage = message;
  log.warn({ active, message: maintenanceMessage }, 'Maintenance mode changed');
}

export function isMaintenanceMode(): boolean {
  return maintenanceActive;
}

export function getMaintenanceInfo(): { active: boolean; message: string } {
  return { active: maintenanceActive, message: maintenanceMessage };
}

export function maintenanceMiddleware(
  req: { method: string; path: string },
  res: {
    status: (code: number) => { json: (body: Record<string, unknown>) => void };
  },
  next: () => void,
): void {
  if (!maintenanceActive) {
    next();
    return;
  }
  const isHealth = req.path.startsWith('/health') || req.path.startsWith('/api/v1/privacy');
  if (isHealth) {
    next();
    return;
  }
  res.status(503).json({
    error: { code: 'MAINTENANCE_MODE', message: maintenanceMessage },
  });
}
