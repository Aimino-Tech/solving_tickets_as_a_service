import { Router, type Request, type Response } from 'express';
import { logAdminAction } from '../audit/service.js';
import { adminAuthMiddleware } from '../security/adminAuth.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'provisioning-api' });

const router: Router = Router();

router.use(adminAuthMiddleware);

const provisioningJobs = new Map<string, {
  id: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  config: Record<string, unknown>;
  error?: string;
  workerInfo?: Record<string, unknown>;
  retryCount: number;
}>();

const MAX_RETRIES = Number(process.env.DLQ_MAX_RETRIES) || 3;

router.post('/workers/provision', async (req: Request, res: Response) => {
  try {
    const config = req.body;
    if (!config || typeof config !== 'object') {
      res.status(400).json({ error: 'Invalid provisioning config' });
      return;
    }

    const id = `prov-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const job = {
      id,
      status: 'creating',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      config,
      retryCount: 0,
    };

    provisioningJobs.set(id, job);

    try {
      const { default: amqplib } = await import('amqplib');
      const conn = await amqplib.connect(process.env.RABBITMQ_URL || 'amqp://localhost');
      const channel = await conn.createChannel();
      await channel.assertExchange('stas.provision', 'direct', { durable: true });
      await channel.assertQueue('stas.provision', { durable: true });
      await channel.bindQueue('stas.provision', 'stas.provision', 'provision.create');
      channel.sendToQueue(
        'stas.provision',
        Buffer.from(JSON.stringify({ job_id: id, config, retry_count: 0 })),
        { persistent: true, headers: { 'x-retry-count': 0 } },
      );
      await channel.close();
      await conn.close();
    } catch (mqErr) {
      log.warn({ err: String(mqErr) }, 'RabbitMQ unavailable — provisioning queued in memory only');
    }

    await logAdminAction({
      adminId: 'admin:api-key',
      action: 'provision.create',
      resourceType: 'provision',
      resourceId: id,
      details: { config },
      ipAddress: req.ip,
      correlationId: req.requestId,
    });

    log.info({ jobId: id }, 'Provisioning job created');
    res.status(202).json({ id, status: 'creating' });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to create provisioning job');
    res.status(500).json({ error: 'Failed to create provisioning job' });
  }
});

router.get('/workers/:id/status', (req: Request, res: Response) => {
  try {
    const job = provisioningJobs.get(req.params.id);
    if (!job) {
      res.status(404).json({ error: 'Provisioning job not found' });
      return;
    }

    res.json({
      id: job.id,
      status: job.status,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      workerInfo: job.workerInfo || null,
      error: job.error || null,
      retryCount: job.retryCount,
    });
  } catch (err) {
    log.error({ err: String(err), id: req.params.id }, 'Failed to get provisioning status');
    res.status(500).json({ error: 'Failed to get provisioning status' });
  }
});

router.get('/workers', (_req: Request, res: Response) => {
  const jobs = Array.from(provisioningJobs.values())
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 50);

  res.json({ jobs, total: provisioningJobs.size });
});

export { router as provisioningRouter };
