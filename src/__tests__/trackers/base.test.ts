/**
 * Unit tests for src/trackers/base.ts — Tracker types and helpers.
 */
import { describe, expect, it } from 'vitest';

describe('trackers/base', () => {
  it('exports formatTicketId and parseTicketId', async () => {
    const mod = await import('../../trackers/base.js');
    expect(mod.formatTicketId).toBeDefined();
    expect(mod.parseTicketId).toBeDefined();
  });

  describe('formatTicketId', () => {
    it('formats as source:id', async () => {
      const mod = await import('../../trackers/base.js');
      expect(mod.formatTicketId('ABC-123', 'linear')).toBe('linear:ABC-123');
      expect(mod.formatTicketId('PROJ-42', 'jira')).toBe('jira:PROJ-42');
    });
  });

  describe('parseTicketId', () => {
    it('parses a formatted ticket ID', async () => {
      const mod = await import('../../trackers/base.js');
      const result = mod.parseTicketId('linear:ABC-123');
      expect(result).toEqual({ source: 'linear', id: 'ABC-123' });
    });

    it('parses jira ticket ID', async () => {
      const mod = await import('../../trackers/base.js');
      const result = mod.parseTicketId('jira:PROJ-42');
      expect(result).toEqual({ source: 'jira', id: 'PROJ-42' });
    });

    it('returns null for invalid format', async () => {
      const mod = await import('../../trackers/base.js');
      expect(mod.parseTicketId('invalid')).toBeNull();
    });

    it('returns null for unknown source', async () => {
      const mod = await import('../../trackers/base.js');
      expect(mod.parseTicketId('unknown:123')).toBeNull();
    });
  });
});
