#!/usr/bin/env npx tsx
/**
 * SYNTARO GitHub Action entrypoint.
 *
 * Reads GitHub event context from the environment and dispatches
 * a fix via the SYNTARO pipeline.
 *
 * Environment variables (set by action.yml):
 *   INPUT_GITHUB_TOKEN    — GitHub token for API access
 *   INPUT_MODEL           — AI model override
 *   INPUT_OPENCODE_ENDPOINT — OpenCode server URL
 *   GITHUB_EVENT_NAME     — The webhook event name (issues, etc.)
 *   GITHUB_REPOSITORY     — owner/repo
 *   GITHUB_EVENT_PATH     — Path to the event payload JSON
 */

import { readFileSync } from 'node:fs';

interface IssueEvent {
  issue?: {
    number: number;
    title: string;
    body: string | null;
    labels: Array<{ name: string }>;
  };
  label?: { name: string };
  repository?: { full_name: string };
}

const REQUIRED_ENV_VARS = ['INPUT_GITHUB_TOKEN', 'INPUT_OPENCODE_ENDPOINT', 'GITHUB_EVENT_PATH'];

async function main(): Promise<void> {
  // Validate environment
  for (const v of REQUIRED_ENV_VARS) {
    if (!process.env[v]) {
      console.error(`Missing required env var: ${v}`);
      process.exit(1);
    }
  }

  const eventName = process.env.GITHUB_EVENT_NAME || '';
  const repo = process.env.GITHUB_REPOSITORY || '';
  const opencodeEndpoint = process.env.INPUT_OPENCODE_ENDPOINT!;
  const model = process.env.INPUT_MODEL || 'default';
  const token = process.env.INPUT_GITHUB_TOKEN!;

  console.log(`SYNTARO Fix Action triggered by: ${eventName}`);
  console.log(`Repository: ${repo}`);
  console.log(`OpenCode endpoint: ${opencodeEndpoint}`);

  // Read event payload
  const eventPath = process.env.GITHUB_EVENT_PATH!;
  let event: IssueEvent;
  try {
    const raw = readFileSync(eventPath, 'utf-8');
    event = JSON.parse(raw) as IssueEvent;
  } catch (err) {
    console.error(`Failed to read event payload: ${err}`);
    process.exit(1);
  }

  // Only process issue.labeled events with syntaro:fix label
  if (eventName !== 'issues' || !event.label?.name?.toLowerCase().includes('syntaro:fix')) {
    console.log(`Ignoring event: label is not syntaro:fix (got: ${event.label?.name})`);
    process.exit(0);
  }

  const issueNumber = event.issue?.number;
  const issueTitle = event.issue?.title;
  const issueBody = event.issue?.body || '';

  if (!issueNumber || !issueTitle) {
    console.error('Event payload missing issue number or title');
    process.exit(1);
  }

  console.log(`Processing issue #${issueNumber}: ${issueTitle}`);

  // Build the fix prompt
  const prompt = buildFixPrompt(repo, issueNumber, issueTitle, issueBody);

  // Dispatch to OpenCode
  console.log('Dispatching to OpenCode...');
  try {
    const response = await fetch(`${opencodeEndpoint}/api/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ prompt, model }),
    });

    if (!response.ok) {
      const error = await response.text().catch(() => 'unknown');
      console.error(`OpenCode returned ${response.status}: ${error}`);
      process.exit(1);
    }

    const result = (await response.json()) as Record<string, unknown>;
    console.log(`Fix completed: ${result.summary || 'no summary'}`);
    console.log(`Confidence: ${result.confidence || 'unknown'}`);
    console.log(`Branch: ${result.branch || 'N/A'}`);
    console.log(`Test output: ${((result.testOutput as string) || '').slice(0, 500)}`);
    process.exit(0);
  } catch (err) {
    console.error(`Failed to dispatch fix: ${err}`);
    process.exit(1);
  }
}

function buildFixPrompt(
  repo: string,
  issueNumber: number,
  issueTitle: string,
  issueBody: string,
): string {
  return [
    '# SYNTARO Fix Agent (GitHub Action)',
    '',
    `You are an autonomous fix agent for **${repo}**.`,
    `Your task is to fix issue **#${issueNumber}: ${issueTitle}**.`,
    '',
    '## Issue Description',
    '',
    issueBody || '(no description provided)',
    '',
    '## Instructions',
    '',
    '1. Investigate the issue and find the root cause.',
    '2. Implement the minimal fix needed.',
    '3. Write a regression test that fails before your fix and passes after.',
    '4. Run the existing test suite to ensure nothing is broken.',
    '5. Commit your changes with a descriptive message.',
    '6. Push the branch and submit the fix.',
  ].join('\n');
}

main().catch((err) => {
  console.error(`Fatal error: ${err}`);
  process.exit(1);
});
