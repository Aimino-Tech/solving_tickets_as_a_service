/**
 * Unit tests for STAS OpenCode plugin — plugin/src/index.ts
 *
 * Tests the plugin registration and tool functions.
 *
 * Strategy:
 *   The plugin module has internal functions (pluginRoot, toolsDir, envOverride, runScript)
 *   and exports tool definitions (stas_webhook_test, stas_config_validate, etc.) and
 *   a default plugin registration function.
 *
 *   We mock execSync and existsSync to control filesystem interactions.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Hoisted mocks ───────────────────────────────────────────────────────────

const mockExecSync = vi.hoisted(() => vi.fn());
const mockExistsSync = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execSync: mockExecSync,
}));

vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
}));

const chainable = () => {
  const c: any = () => c;
  c.default = () => c;
  c.describe = () => c;
  c.string = () => c;
  c.optional = () => c;
  c.nullable = () => c;
  c.array = () => c;
  c.object = () => c;
  return c;
};

const mockTool = Object.assign(
  vi.fn((def: any) => def),
  { schema: chainable() },
);

vi.mock('@opencode-ai/plugin', () => ({
  tool: mockTool,
}));

// ── Suite ───────────────────────────────────────────────────────────────────

describe('STAS Plugin', () => {
  let plugin: typeof import('../../../plugin/src/index.js');

  beforeAll(async () => {
    vi.clearAllMocks();
    plugin = await import('../../../plugin/src/index.js');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockExecSync.mockReturnValue('mock output');
    mockExistsSync.mockReturnValue(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Plugin exports ──────────────────────────────────────────────────────

  describe('plugin exports', () => {
    it('exports a default function', () => {
      expect(typeof plugin.default).toBe('function');
    });

    it('default export returns a Hooks object with tool definitions', async () => {
      const hooks = await plugin.default();
      expect(hooks).toHaveProperty('tool');
      expect(hooks.tool).toHaveProperty('stas_webhook_test');
      expect(hooks.tool).toHaveProperty('stas_config_validate');
      expect(hooks.tool).toHaveProperty('stas_status');
      expect(hooks.tool).toHaveProperty('stas_dev_start');
    });
  });

  // ── Tool: stas_webhook_test ─────────────────────────────────────────────

  describe('stas_webhook_test tool', () => {
    it('executes the webhook test script', async () => {
      const hooks = await plugin.default();
      const tool = hooks.tool.stas_webhook_test;

      const result = await tool.execute(
        { event: 'issues.labeled', payloadFile: undefined, stasUrl: undefined },
        { directory: '/test/project' },
      );

      expect(result).toBeDefined();
      expect(result.output).toBe('mock output');
      expect(result.metadata?.tool).toBe('stas_webhook_test');
    });

    it('returns error output when script does not exist', async () => {
      mockExistsSync.mockReturnValue(false);

      const hooks = await plugin.default();
      const tool = hooks.tool.stas_webhook_test;

      const result = await tool.execute(
        { event: 'issues.labeled', payloadFile: undefined, stasUrl: undefined },
        { directory: '/test/project' },
      );

      expect(result.output).toContain('not found');
    });
  });

  // ── Tool: stas_config_validate ──────────────────────────────────────────

  describe('stas_config_validate tool', () => {
    it('executes config check with check mode', async () => {
      const hooks = await plugin.default();
      const tool = hooks.tool.stas_config_validate;

      const result = await tool.execute(
        { mode: 'check', envFile: undefined },
        { directory: '/test/project' },
      );

      expect(result.output).toBe('mock output');
      expect(result.metadata?.mode).toBe('check');
    });

    it('executes config check with init mode', async () => {
      const hooks = await plugin.default();
      const tool = hooks.tool.stas_config_validate;

      const result = await tool.execute(
        { mode: 'init', envFile: undefined },
        { directory: '/test/project' },
      );

      expect(result.output).toBe('mock output');
      expect(result.metadata?.mode).toBe('init');
    });
  });

  // ── Tool: stas_status ───────────────────────────────────────────────────

  describe('stas_status tool', () => {
    it('executes status check with default URLs', async () => {
      const hooks = await plugin.default();
      const tool = hooks.tool.stas_status;

      const result = await tool.execute(
        { stasUrl: undefined, opencodeUrl: undefined },
        { directory: '/test/project' },
      );

      expect(result.output).toBe('mock output');
      expect(result.metadata?.tool).toBe('stas_status');
    });

    it('executes status check with custom URLs', async () => {
      const hooks = await plugin.default();
      const tool = hooks.tool.stas_status;

      const result = await tool.execute(
        { stasUrl: 'http://localhost:3001', opencodeUrl: 'http://localhost:4097' },
        { directory: '/test/project' },
      );

      expect(result.output).toBe('mock output');
    });
  });

  // ── Tool: stas_dev_start ────────────────────────────────────────────────

  describe('stas_dev_start tool', () => {
    it('executes dev start with full mode', async () => {
      const hooks = await plugin.default();
      const tool = hooks.tool.stas_dev_start;

      const result = await tool.execute(
        { mode: 'full', opencodePort: undefined, stasPort: undefined },
        { directory: '/test/project' },
      );

      expect(result.output).toBe('mock output');
      expect(result.metadata?.mode).toBe('full');
    });

    it('executes dev start with bot-only mode', async () => {
      const hooks = await plugin.default();
      const tool = hooks.tool.stas_dev_start;

      const result = await tool.execute(
        { mode: 'bot-only', opencodePort: undefined, stasPort: undefined },
        { directory: '/test/project' },
      );

      expect(result.output).toBe('mock output');
    });

    it('executes dev start with opencode-only mode', async () => {
      const hooks = await plugin.default();
      const tool = hooks.tool.stas_dev_start;

      const result = await tool.execute(
        { mode: 'opencode-only', opencodePort: undefined, stasPort: undefined },
        { directory: '/test/project' },
      );

      expect(result.output).toBe('mock output');
    });
  });

  // ── Error handling in tools ─────────────────────────────────────────────

  describe('tool error handling', () => {
    it('handles execSync failures gracefully', async () => {
      mockExecSync.mockImplementation(() => { throw { stderr: 'Script error', status: 1 }; });

      const hooks = await plugin.default();
      const tool = hooks.tool.stas_status;

      const result = await tool.execute(
        { stasUrl: undefined, opencodeUrl: undefined },
        { directory: '/test/project' },
      );

      expect(result.output).toContain('failed');
      expect(result.metadata?.error).toBe(true);
    });

    it('handles execSync with minimal error info', async () => {
      mockExecSync.mockImplementation(() => { throw { message: 'Command failed' }; });

      const hooks = await plugin.default();
      const tool = hooks.tool.stas_status;

      const result = await tool.execute(
        { stasUrl: undefined, opencodeUrl: undefined },
        { directory: '/test/project' },
      );

      expect(result.output).toContain('Command failed');
      expect(result.metadata?.error).toBe(true);
    });
  });
});
