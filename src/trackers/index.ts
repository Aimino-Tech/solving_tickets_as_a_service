import { config } from "../config.js";
import { rootLogger } from "../utils/logger.js";
import type { Tracker } from "./base.js";
import { LinearTracker } from "./linear.js";
import { JiraTracker } from "./jira.js";

const log = rootLogger.child({ module: "trackers" });

const trackers = new Map<string, Tracker>();

export function getTracker(source: "linear" | "jira"): Tracker | undefined {
  return trackers.get(source);
}

export function getAllTrackers(): Tracker[] {
  return Array.from(trackers.values());
}

export function hasTracker(source: "linear" | "jira"): boolean {
  return trackers.has(source);
}

export function initTrackers(): void {
  const linearConfig = config.trackers?.linear;
  if (linearConfig?.apiKey) {
    trackers.set("linear", new LinearTracker());
    log.info("Linear tracker initialized");
  } else {
    log.info("Linear tracker not configured (LINEAR_API_KEY missing)");
  }

  const jiraConfig = config.trackers?.jira;
  if (jiraConfig?.url && jiraConfig?.email && jiraConfig?.apiToken) {
    trackers.set("jira", new JiraTracker());
    log.info("Jira tracker initialized");
  } else {
    log.info("Jira tracker not configured (JIRA_URL/EMAIL/API_TOKEN missing)");
  }
}

export { LinearTracker } from "./linear.js";
export { JiraTracker } from "./jira.js";
export * from "./base.js";
