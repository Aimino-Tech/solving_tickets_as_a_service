/**
 * GitHub webhook event handlers.
 *
 * Receives webhook events from GitHub and routes them to the appropriate
 * handlers. Primary handler is issues.labeled with the "stas:fix" label.
 * Also handles marketplace_purchase for billing plan changes.
 */

import { Webhooks, type EmitterWebhookEventName } from "@octokit/webhooks";
import type { Queue } from "bullmq";
import { config } from "../config.js";
import { enqueueIssue } from "../queue/issueQueue.js";
import type { IssueJobData, BillingPlan } from "../utils/types.js";
import { rootLogger } from "../utils/logger.js";

const log = rootLogger.child({ module: "webhooks-github" });

/**
 * Create the GitHub webhooks handler with all event listeners registered.
 */
export function createGithubWebhooks(
  queue: Queue<IssueJobData>,
): Webhooks {
  const webhooks = new Webhooks({
    secret: config.github.webhookSecret,
  });

  // ── issues.opened ───────────────────────────────────────────────
  webhooks.on("issues.opened", async ({ payload }) => {
    log.info(
      {
        repo: `${payload.repository.owner.login}/${payload.repository.name}`,
        issueNumber: payload.issue.number,
      },
      "Received issues.opened event",
    );
    // We wait for the label event instead of acting on open
  });

  // ── issues.labeled ──────────────────────────────────────────────
  webhooks.on("issues.labeled", async ({ payload }) => {
    const label = payload.label?.name;
    if (label !== config.stas.label) {
      log.debug(
        { label, expected: config.stas.label },
        "Ignoring non-target label",
      );
      return;
    }

    log.info(
      {
        repo: `${payload.repository.owner.login}/${payload.repository.name}`,
        issueNumber: payload.issue.number,
        label,
      },
      "Received issues.labeled with target label",
    );

    const jobData: IssueJobData = {
      installationId: payload.installation?.id ?? 0,
      repoOwner: payload.repository.owner.login,
      repoName: payload.repository.name,
      repoPrivate: payload.repository.private,
      issueNumber: payload.issue.number,
      issueTitle: payload.issue.title,
      issueBody: payload.issue.body,
    };

    if (!jobData.installationId) {
      log.error("No installation ID in payload — cannot process");
      return;
    }

    await enqueueIssue(queue, jobData);
  });

  // ── issues.edited ────────────────────────────────────────────────
  webhooks.on("issues.edited", async ({ payload }) => {
    // If the issue already has the label and was edited, we could re-process
    const labels = payload.issue.labels ?? [];
    const hasStasLabel = labels.some(
      (l: { name?: string } | string) => (typeof l === "string" ? l : l.name) === config.stas.label,
    );

    if (hasStasLabel) {
      log.info(
        {
          repo: `${payload.repository.owner.login}/${payload.repository.name}`,
          issueNumber: payload.issue.number,
        },
        "Target issue edited — re-enqueuing",
      );

      const jobData: IssueJobData = {
        installationId: payload.installation?.id ?? 0,
        repoOwner: payload.repository.owner.login,
        repoName: payload.repository.name,
        repoPrivate: payload.repository.private,
        issueNumber: payload.issue.number,
        issueTitle: payload.issue.title,
        issueBody: payload.issue.body,
      };

      if (jobData.installationId) {
        await enqueueIssue(queue, jobData);
      }
    }
  });

  // ── marketplace_purchase ─────────────────────────────────────────
  webhooks.on("marketplace_purchase" as EmitterWebhookEventName, async ({ payload }) => {
    const p = payload as unknown as {
      action: string;
      effective_date: string;
      marketplace_purchase: {
        account: { id: number; type: string };
        plan: { name: string };
      };
    };

    const plan: BillingPlan = {
      plan: mapMarketplacePlan(p.marketplace_purchase.plan.name),
      accountId: p.marketplace_purchase.account.id,
      effectiveAt: p.effective_date,
    };

    log.info(
      {
        action: p.action,
        accountId: plan.accountId,
        plan: plan.plan,
      },
      "Marketplace purchase event",
    );

    // TODO: Update the billing plan in the database
    // For OSS self-hosted, billing is a no-op
  });

  return webhooks;
}

/**
 * Map GitHub Marketplace plan names to internal plan types.
 */
function mapMarketplacePlan(planName: string): BillingPlan["plan"] {
  const lower = planName.toLowerCase();
  if (lower.includes("enterprise")) return "enterprise";
  if (lower.includes("pro") || lower.includes("premium")) return "pro";
  return "free";
}

/**
 * Suggest labels based on issue content using keyword matching.
 * Useful for recommending labels before the full triage runs.
 */
export function suggestLabels(
  title: string,
  body: string,
): string[] {
  const text = `${title}\n${body}`.toLowerCase();
  const labels: string[] = [];

  // Bug indicators
  const bugPatterns = [
    "bug", "fix", "error", "crash", "broken", "fails", "failure",
    "incorrect", "wrong", "issue", "problem", "bug report",
  ];
  if (bugPatterns.some((p) => text.includes(p))) {
    labels.push("bug");
  }

  // Feature indicators
  const featurePatterns = [
    "feature", "request", "would like", "please add", "suggestion",
    "idea", "enhancement", "new feature",
  ];
  if (featurePatterns.some((p) => text.includes(p))) {
    labels.push("enhancement");
  }

  // Question indicators
  const questionPatterns = [
    "how to", "how do i", "question", "help", "not sure",
    "what is", "how can", "guide",
  ];
  if (questionPatterns.some((p) => text.includes(p))) {
    labels.push("question");
  }

  // Documentation indicators
  const docsPatterns = [
    "docs", "documentation", "readme", "typo",
    "spelling", "readability",
  ];
  if (docsPatterns.some((p) => text.includes(p))) {
    labels.push("documentation");
  }

  // Performance
  const perfPatterns = [
    "slow", "performance", "latency", "memory", "leak",
    "optimize", "bottleneck",
  ];
  if (perfPatterns.some((p) => text.includes(p))) {
    labels.push("performance");
  }

  return labels;
}
