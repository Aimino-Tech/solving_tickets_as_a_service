import { describe, expect, it } from 'vitest';
import { formatProgressMessage } from '../../channels/base.js';

describe('channels/base', () => {
  describe('formatProgressMessage', () => {
    it('formats a basic progress message', () => {
      const msg = formatProgressMessage('queued', 'run-123');
      expect(msg).toContain('Queued');
      expect(msg).toContain('run-123');
    });

    it('includes detail when provided', () => {
      const msg = formatProgressMessage('investigating', 'run-456', 'Analyzing code');
      expect(msg).toContain('Investigating');
      expect(msg).toContain('run-456');
      expect(msg).toContain('Analyzing code');
    });

    it('includes PR URL when provided', () => {
      const msg = formatProgressMessage('pr_created', 'run-789', undefined, 'https://github.com/owner/repo/pull/1');
      expect(msg).toContain('PR Created');
      expect(msg).toContain('https://github.com/owner/repo/pull/1');
    });

    it('handles all progress phases', () => {
      const phases = ['queued', 'investigating', 'fixing', 'testing', 'verifying', 'committing', 'pr_created', 'failed', 'error'] as const;
      for (const phase of phases) {
        const msg = formatProgressMessage(phase, 'test-run');
        expect(msg).toContain('test-run');
        expect(msg.length).toBeGreaterThan(10);
      }
    });
  });
});
