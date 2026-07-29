/**
 * Approval Gate — Config-driven approval workflow for production-impacting tickets.
 *
 * Intercepts issue dispatch for orgs/repos requiring approval before executing
 * fixes. Stores pending approvals in-process and exposes a REST API for
 * approval/rejection flow. Auto-approves after 30 seconds if no action is taken.
 *
 * Routes (mounted at /api/approvals):
 *   GET    /api/approvals/pending        — List pending approvals
 *   POST   /api/approvals/:id/approve    — Approve a pending dispatch
 *   POST   /api/approvals/:id/reject     — Reject a pending dispatch
 *   GET    /api/approvals/config         — Get current approval gate config
 *
 * @module middleware/approvalGate
 */

import { Router, type Request, type Response } from 'express';
import crypto from 'node:crypto';
import { rootLogger } from '../utils/logger.js';
import { config } from '../config.js';
import { logAdminAction } from '../audit/service.js';

const log = rootLogger.child({ module: 'approval-gate' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for which orgs/repos require approval. */
export interface ApprovalGateConfig {
  /** List of GitHub orgs (owners) that require approval for all repos. */
  requiredOrgs: string[];
  /** Specific repos (org/repo) that require approval. */
  requiredRepos: string[];
  /** Labels that trigger the approval gate (e.g. 'production', 'stas:fix:approval'). */
  triggerLabels: string[];
  /** Whether the approval gate is enabled globally. */
  enabled: boolean;
}

/** A single pending approval request. */
export interface PendingApproval {
  id: string;
  issueNumber: number;
  repoOwner: string;
  repoName: string;
  issueTitle: string;
  labels: string[];
  requestedAt: string;
  requestedBy: string;
  status: 'pending' | 'approved' | 'rejected';
  approvedAt?: string;
  approvedBy?: string;
  rejectedAt?: string;
  rejectedBy?: string;
  rejectionReason?: string;
  /** Correlation ID for tracing through the dispatch pipeline. */
  correlationId?: string;
}

// ---------------------------------------------------------------------------
// Default configuration
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: ApprovalGateConfig = {
  requiredOrgs: [],
  requiredRepos: [],
  triggerLabels: ['production', 'stas:fix:approval'],
  enabled: false,
};

let approvalConfig: ApprovalGateConfig = { ...DEFAULT_CONFIG };

// In-memory store for pending approvals
const pendingApprovals = new Map<string, PendingApproval>();

// ---------------------------------------------------------------------------
// Auto-approve timer constants and map
// ---------------------------------------------------------------------------

/** How long to wait before auto-approving (30 seconds). */
const AUTO_APPROVE_TIMEOUT_MS = 30_000;

/** Map of approval ID to its auto-approve timer handle. Cleared on manual action. */
const autoApproveTimers = new Map<string, ReturnType<typeof setTimeout>>();

// ---------------------------------------------------------------------------
// Config management
// ---------------------------------------------------------------------------

/**
 * Configure the approval gate at runtime.
 * Can be called from server startup or config hot-reload.
 */
export function configureApprovalGate(cfg: Partial<ApprovalGateConfig>): void {
  approvalConfig = { ...approvalConfig, ...cfg };
  log.info(
    {
      enabled: approvalConfig.enabled,
      requiredOrgs: approvalConfig.requiredOrgs.length,
      requiredRepos: approvalConfig.requiredRepos.length,
      triggerLabels: approvalConfig.triggerLabels,
    },
    'Approval gate configured',
  );
}

/**
 * Get the current approval gate configuration.
 */
export function getApprovalConfig(): ApprovalGateConfig {
  return { ...approvalConfig };
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

/**
 * Check whether a given dispatch requires approval before proceeding.
 *
 * @returns An object with `requiresApproval` boolean and, if true, the
 *          generated `PendingApproval` that was stored.
 */
export function checkRequiresApproval(params: {
  repoOwner: string;
  repoName: string;
  issueNumber: number;
  issueTitle: string;
  labels: string[];
  requestedBy?: string;
  correlationId?: string;
}): { requiresApproval: boolean; approval?: PendingApproval } {
  if (!approvalConfig.enabled) {
    return { requiresApproval: false };
  }

  const { repoOwner, repoName, issueNumber, issueTitle, labels, requestedBy, correlationId } = params;

  // Check if the repo/org is in the required list
  const orgRequired = approvalConfig.requiredOrgs.includes(repoOwner);
  const repoRequired = approvalConfig.requiredRepos.includes(`${repoOwner}/${repoName}`);

  if (!orgRequired && !repoRequired) {
    return { requiresApproval: false };
  }

  // Check if any trigger labels are present on the issue
  const hasTriggerLabel = labels.some((label) =>
    approvalConfig.triggerLabels.some(
      (trigger) => label.toLowerCase() === trigger.toLowerCase(),
    ),
  );

  if (!hasTriggerLabel) {
    return { requiresApproval: false };
  }

  // Create a pending approval entry
  const approval: PendingApproval = {
    id: crypto.randomUUID(),
    issueNumber,
    repoOwner,
    repoName,
    issueTitle,
    labels,
    requestedAt: new Date().toISOString(),
    requestedBy: requestedBy ?? 'unknown',
    status: 'pending',
    correlationId,
  };

  pendingApprovals.set(approval.id, approval);

  log.info(
    {
      approvalId: approval.id,
      repo: `${repoOwner}/${repoName}`,
      issueNumber,
      issueTitle,
    },
    'Approval gate: created pending approval',
  );

  // ── Auto-approve timer ───────────────────────────────────────────
  // If not approved/rejected within 30 seconds, auto-approve it.
  const timer = setTimeout(() => {
    const current = pendingApprovals.get(approval.id);
    if (current && current.status === 'pending') {
      current.status = 'approved';
      current.approvedAt = new Date().toISOString();
      current.approvedBy = 'auto-approve-timer';
      log.info(
        {
          approvalId: approval.id,
          repo: `${repoOwner}/${repoName}`,
          issueNumber,
          issueTitle,
        },
        'Approval gate: auto-approved after timeout',
      );

      // Self-audit the auto-approval
      logAdminAction({
        adminId: 'auto-approve-timer',
        action: 'approval.auto_approve',
        resourceType: 'approval',
        resourceId: approval.id,
        details: {
          repoOwner,
          repoName,
          issueNumber,
          issueTitle,
          reason: 'Auto-approve timer expired (30s)',
        },
        correlationId,
      }).catch((err) => log.error({ err: String(err) }, 'Failed to log auto-approval audit'));
    }
    autoApproveTimers.delete(approval.id);
  }, AUTO_APPROVE_TIMEOUT_MS);

  autoApproveTimers.set(approval.id, timer);

  return { requiresApproval: true, approval };
}

/**
 * Approve a pending dispatch.
 */
export function approveApproval(params: {
  id: string;
  approvedBy: string;
  correlationId?: string;
}): PendingApproval | null {
  const { id, approvedBy, correlationId } = params;
  const approval = pendingApprovals.get(id);

  if (!approval) {
    log.warn({ approvalId: id }, 'Approval gate: approval not found for approve');
    return null;
  }

  if (approval.status !== 'pending') {
    log.warn(
      { approvalId: id, status: approval.status },
      'Approval gate: approval is not in pending state',
    );
    return null;
  }

  // Clear the auto-approve timer if it exists
  const timer = autoApproveTimers.get(id);
  if (timer) {
    clearTimeout(timer);
    autoApproveTimers.delete(id);
  }

  approval.status = 'approved';
  approval.approvedAt = new Date().toISOString();
  approval.approvedBy = approvedBy;

  log.info(
    {
      approvalId: id,
      repo: `${approval.repoOwner}/${approval.repoName}`,
      issueNumber: approval.issueNumber,
      approvedBy,
    },
    'Approval gate: dispatch approved',
  );

  // Self-audit the approval action
  logAdminAction({
    adminId: approvedBy,
    action: 'approval.approve',
    resourceType: 'approval',
    resourceId: id,
    details: {
      repoOwner: approval.repoOwner,
      repoName: approval.repoName,
      issueNumber: approval.issueNumber,
      issueTitle: approval.issueTitle,
    },
    correlationId,
  }).catch((err) => log.error({ err: String(err) }, 'Failed to log approval audit'));

  return approval;
}

/**
 * Reject a pending dispatch.
 */
export function rejectApproval(params: {
  id: string;
  rejectedBy: string;
  reason?: string;
  correlationId?: string;
}): PendingApproval | null {
  const { id, rejectedBy, reason, correlationId } = params;
  const approval = pendingApprovals.get(id);

  if (!approval) {
    log.warn({ approvalId: id }, 'Approval gate: approval not found for reject');
    return null;
  }

  if (approval.status !== 'pending') {
    log.warn(
      { approvalId: id, status: approval.status },
      'Approval gate: approval is not in pending state',
    );
    return null;
  }

  // Clear the auto-approve timer if it exists
  const timer = autoApproveTimers.get(id);
  if (timer) {
    clearTimeout(timer);
    autoApproveTimers.delete(id);
  }

  approval.status = 'rejected';
  approval.rejectedAt = new Date().toISOString();
  approval.rejectedBy = rejectedBy;
  approval.rejectionReason = reason;

  log.info(
    {
      approvalId: id,
      repo: `${approval.repoOwner}/${approval.repoName}`,
      issueNumber: approval.issueNumber,
      rejectedBy,
      reason,
    },
    'Approval gate: dispatch rejected',
  );

  // Self-audit the rejection action
  logAdminAction({
    adminId: rejectedBy,
    action: 'approval.reject',
    resourceType: 'approval',
    resourceId: id,
    details: {
      repoOwner: approval.repoOwner,
      repoName: approval.repoName,
      issueNumber: approval.issueNumber,
      issueTitle: approval.issueTitle,
      reason,
    },
    correlationId,
  }).catch((err) => log.error({ err: String(err) }, 'Failed to log rejection audit'));

  return approval;
}

/**
 * Get all pending approvals.
 */
export function getPendingApprovals(): PendingApproval[] {
  return Array.from(pendingApprovals.values()).filter((a) => a.status === 'pending');
}

/**
 * Get a specific approval by ID.
 */
export function getApprovalById(id: string): PendingApproval | undefined {
  return pendingApprovals.get(id);
}

/**
 * Get all approvals with an optional status filter.
 */
export function listApprovals(status?: 'pending' | 'approved' | 'rejected'): PendingApproval[] {
  const all = Array.from(pendingApprovals.values());
  if (status) {
    return all.filter((a) => a.status === status);
  }
  return all;
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/**
 * Remove old approvals from the in-memory store (older than the given age in ms).
 * Called periodically by a maintenance timer.
 */
export function pruneOldApprovals(maxAgeMs: number = 86_400_000): number {
  const cutoff = Date.now() - maxAgeMs;
  let pruned = 0;
  for (const [id, approval] of pendingApprovals) {
    const requestedAt = new Date(approval.requestedAt).getTime();
    if (requestedAt < cutoff) {
      // Clear any associated auto-approve timer
      const timer = autoApproveTimers.get(id);
      if (timer) {
        clearTimeout(timer);
        autoApproveTimers.delete(id);
      }
      pendingApprovals.delete(id);
      pruned++;
    }
  }
  if (pruned > 0) {
    log.info({ pruned }, 'Approval gate: pruned old approvals');
  }
  return pruned;
}

// ---------------------------------------------------------------------------
// Express Router
// ---------------------------------------------------------------------------

const router: Router = Router();

/**
 * GET /api/approvals/pending — List all pending approvals.
 */
router.get('/approvals/pending', (_req: Request, res: Response) => {
  const pending = getPendingApprovals();
  res.json({
    approvals: pending,
    total: pending.length,
  });
});

/**
 * GET /api/approvals — List all approvals (optionally filtered by status).
 */
router.get('/approvals', (req: Request, res: Response) => {
  const status = req.query.status as 'pending' | 'approved' | 'rejected' | undefined;
  const approvals = listApprovals(status);
  res.json({
    approvals,
    total: approvals.length,
  });
});

/**
 * GET /api/approvals/config — Get the current approval gate configuration.
 * MUST be defined before /:id routes to avoid Express matching "config" as an :id param.
 */
router.get('/approvals/config', (_req: Request, res: Response) => {
  res.json(getApprovalConfig());
});

/**
 * GET /api/approvals/:id — Get a specific approval by ID.
 */
router.get('/approvals/:id', (req: Request, res: Response) => {
  const approval = getApprovalById(req.params.id);
  if (!approval) {
    res.status(404).json({ error: 'Approval not found' });
    return;
  }
  res.json(approval);
});

/**
 * POST /api/approvals/:id/approve — Approve a pending dispatch.
 */
router.post('/approvals/:id/approve', (req: Request, res: Response) => {
  const approvedBy = (req.body.approvedBy as string) || req.headers['x-admin-key'] as string || 'api-user';
  const result = approveApproval({
    id: req.params.id,
    approvedBy,
    correlationId: req.requestId,
  });

  if (!result) {
    res.status(404).json({ error: 'Approval not found or already processed' });
    return;
  }

  res.json({ status: 'approved', approval: result });
});

/**
 * POST /api/approvals/:id/reject — Reject a pending dispatch.
 */
router.post('/approvals/:id/reject', (req: Request, res: Response) => {
  const rejectedBy = (req.body.rejectedBy as string) || req.headers['x-admin-key'] as string || 'api-user';
  const reason = req.body.reason as string | undefined;
  const result = rejectApproval({
    id: req.params.id,
    rejectedBy,
    reason,
    correlationId: req.requestId,
  });

  if (!result) {
    res.status(404).json({ error: 'Approval not found or already processed' });
    return;
  }

  res.json({ status: 'rejected', approval: result });
});

export { router as approvalRouter };
