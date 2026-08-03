/**
 * Unit tests for src/platforms/messages.ts — powered-by footer viral mechanics.
 *
 * Covers:
 * 1. poweredByFooter() with ref param, gated by the config toggle
 * 2. buildPRBody footer injection (ref=pr-footer)
 * 3. highConfidenceIssueComment / draftIssueComment footer injection (ref=pr-comment)
 */

import { describe, expect, it, vi } from 'vitest';
import { sampleAgentResult } from '../fixtures.js';

// Mutable mock config so tests can flip the footer toggle at runtime.
// vi.hoisted keeps the object available inside the hoisted vi.mock factory.
const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    syntaro: { botName: 'SYNTARO', poweredByFooterEnabled: true },
  },
}));

vi.mock('../../config.js', () => ({
  config: mockConfig,
}));

import {
  buildPRBody,
  draftIssueComment,
  highConfidenceIssueComment,
  poweredByFooter,
} from '../../platforms/messages.js';

const FOOTER_URL = 'https://syntaro.io/?ref=';
const FOOTER_TEXT = 'AI code review & fix automation';

describe('poweredByFooter', () => {
  it('returns the tracked footer with the given ref when enabled', () => {
    const footer = poweredByFooter('pr-footer');
    expect(footer).toContain('---');
    expect(footer).toContain(`_Powered by [Syntaro](${FOOTER_URL}pr-footer) — ${FOOTER_TEXT}_`);
  });

  it('uses the ref passed for the placement (pr-comment)', () => {
    expect(poweredByFooter('pr-comment')).toContain(`${FOOTER_URL}pr-comment`);
  });

  it('returns an empty string when the toggle is disabled', () => {
    mockConfig.syntaro.poweredByFooterEnabled = false;
    try {
      expect(poweredByFooter('pr-footer')).toBe('');
    } finally {
      mockConfig.syntaro.poweredByFooterEnabled = true;
    }
  });
});

describe('buildPRBody', () => {
  const params = {
    issueNumber: 42,
    result: sampleAgentResult(),
    fileLinks: ['src/login.ts'],
    isDraft: false,
    branchName: 'syntaro/fix-42',
  };

  it('appends the powered-by footer to the PR body when enabled', () => {
    const body = buildPRBody(params);
    expect(body).toContain(`_Powered by [Syntaro](${FOOTER_URL}pr-footer) — ${FOOTER_TEXT}_`);
    // Footer sits after the bot signature line.
    expect(body.indexOf('_Powered by [Syntaro]')).toBeGreaterThan(body.indexOf('Automated fix by Syntaro'));
  });

  it('omits the footer when the toggle is disabled', () => {
    mockConfig.syntaro.poweredByFooterEnabled = false;
    try {
      const body = buildPRBody(params);
      expect(body).not.toContain('Powered by [Syntaro]');
      expect(body).not.toContain(FOOTER_URL);
      // No dangling separator left behind either.
      expect(body.trimEnd()).not.toMatch(/---$/);
    } finally {
      mockConfig.syntaro.poweredByFooterEnabled = true;
    }
  });
});

describe('issue comment footers', () => {
  const result = sampleAgentResult();

  it('highConfidenceIssueComment includes the pr-comment footer when enabled', () => {
    const comment = highConfidenceIssueComment(42, result);
    expect(comment).toContain(`_Powered by [Syntaro](${FOOTER_URL}pr-comment) — ${FOOTER_TEXT}_`);
  });

  it('draftIssueComment includes the pr-comment footer when enabled', () => {
    const comment = draftIssueComment(42, result);
    expect(comment).toContain(`_Powered by [Syntaro](${FOOTER_URL}pr-comment) — ${FOOTER_TEXT}_`);
  });

  it('omits the footer from both comments when the toggle is disabled', () => {
    mockConfig.syntaro.poweredByFooterEnabled = false;
    try {
      expect(highConfidenceIssueComment(42, result)).not.toContain('Powered by [Syntaro]');
      expect(draftIssueComment(42, result)).not.toContain('Powered by [Syntaro]');
    } finally {
      mockConfig.syntaro.poweredByFooterEnabled = true;
    }
  });
});
