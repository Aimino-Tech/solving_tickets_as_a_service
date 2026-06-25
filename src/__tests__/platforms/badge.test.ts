import { describe, expect, it } from 'vitest';

describe('statusToBadge', () => {
  it('maps completed to passed/success', async () => {
    const { statusToBadge } = await import('../../platforms/badge.js');
    expect(statusToBadge('completed')).toEqual({ label: 'fix', message: 'passed', color: 'success' });
  });
  it('maps success to passed/success', async () => {
    const { statusToBadge } = await import('../../platforms/badge.js');
    expect(statusToBadge('success')).toEqual({ label: 'fix', message: 'passed', color: 'success' });
  });
  it('maps passed to passed/success', async () => {
    const { statusToBadge } = await import('../../platforms/badge.js');
    expect(statusToBadge('passed')).toEqual({ label: 'fix', message: 'passed', color: 'success' });
  });
  it('maps failed to failed/critical', async () => {
    const { statusToBadge } = await import('../../platforms/badge.js');
    expect(statusToBadge('failed')).toEqual({ label: 'fix', message: 'failed', color: 'critical' });
  });
  it('maps running to pending/blue', async () => {
    const { statusToBadge } = await import('../../platforms/badge.js');
    expect(statusToBadge('running')).toEqual({ label: 'fix', message: 'pending', color: 'blue' });
  });
  it('maps pending to pending/blue', async () => {
    const { statusToBadge } = await import('../../platforms/badge.js');
    expect(statusToBadge('pending')).toEqual({ label: 'fix', message: 'pending', color: 'blue' });
  });
  it('maps queued to queued/yellow', async () => {
    const { statusToBadge } = await import('../../platforms/badge.js');
    expect(statusToBadge('queued')).toEqual({ label: 'fix', message: 'queued', color: 'yellow' });
  });
  it('maps cancelled to cancelled/inactive', async () => {
    const { statusToBadge } = await import('../../platforms/badge.js');
    expect(statusToBadge('cancelled')).toEqual({ label: 'fix', message: 'cancelled', color: 'inactive' });
  });
  it('maps unknown to status/lightgrey', async () => {
    const { statusToBadge } = await import('../../platforms/badge.js');
    expect(statusToBadge('some-unknown-status')).toEqual({ label: 'fix', message: 'some-unknown-status', color: 'lightgrey' });
  });
});

describe('renderBadgeSvg', () => {
  it('returns a valid SVG string', async () => {
    const { renderBadgeSvg, statusToBadge } = await import('../../platforms/badge.js');
    const svg = renderBadgeSvg(statusToBadge('completed'));
    expect(svg).toBeTypeOf('string');
    expect(svg.trim()).toMatch(/^<svg/);
    expect(svg.trim()).toMatch(/<\/svg>$/);
  });
  it('includes the label and message in output', async () => {
    const { renderBadgeSvg, statusToBadge } = await import('../../platforms/badge.js');
    const svg = renderBadgeSvg(statusToBadge('failed'));
    expect(svg).toContain('fix');
    expect(svg).toContain('failed');
  });
  it('sets proper SVG attributes', async () => {
    const { renderBadgeSvg, statusToBadge } = await import('../../platforms/badge.js');
    const svg = renderBadgeSvg(statusToBadge('completed'));
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('role="img"');
    expect(svg).toContain('aria-label="fix: passed"');
  });
  it('renders all statuses', async () => {
    const { renderBadgeSvg, statusToBadge } = await import('../../platforms/badge.js');
    for (const st of ['completed', 'failed', 'running', 'queued', 'cancelled', 'unknown']) {
      const svg = renderBadgeSvg(statusToBadge(st));
      expect(svg.trim()).toMatch(/^<svg/);
      expect(svg.trim()).toMatch(/<\/svg>$/);
    }
  });
  it('escapes XML special characters', async () => {
    const { renderBadgeSvg } = await import('../../platforms/badge.js');
    const svg = renderBadgeSvg({ label: 'fix', message: 'a & b < c > d', color: 'success' });
    expect(svg).toContain('&amp;');
    expect(svg).toContain('&lt;');
    expect(svg).toContain('&gt;');
    expect(svg).not.toContain('aria-label="fix: a & b < c > d"');
  });
});

describe('badgeToJson', () => {
  it('serialises to shields.io JSON format', async () => {
    const { badgeToJson } = await import('../../platforms/badge.js');
    expect(badgeToJson({ label: 'fix', message: 'passed', color: 'success' })).toEqual({
      schemaVersion: 1, label: 'fix', message: 'passed', color: 'success',
    });
  });
});

describe('escapeXml', () => {
  it('escapes ampersands', async () => {
    const { escapeXml } = await import('../../platforms/badge.js');
    expect(escapeXml('a & b')).toBe('a &amp; b');
  });
  it('escapes angle brackets', async () => {
    const { escapeXml } = await import('../../platforms/badge.js');
    expect(escapeXml('<tag>')).toBe('&lt;tag&gt;');
  });
  it('escapes quotes', async () => {
    const { escapeXml } = await import('../../platforms/badge.js');
    expect(escapeXml('say "hello"')).toBe('say &quot;hello&quot;');
    expect(escapeXml("it's")).toBe("it&apos;s");
  });
  it('passes through safe strings', async () => {
    const { escapeXml } = await import('../../platforms/badge.js');
    expect(escapeXml('hello world')).toBe('hello world');
  });
});
