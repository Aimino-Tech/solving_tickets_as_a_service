import { describe, expect, it } from 'vitest';

describe('buildDiscoveryManifest', () => {
  it('returns manifest with correct schema version', async () => {
    const { buildDiscoveryManifest } = await import('../../routes/viral.js');
    const m = buildDiscoveryManifest('http://localhost:3000');
    expect(m.schemaVersion).toBe('2024-11-05');
  });
  it('includes server metadata', async () => {
    const { buildDiscoveryManifest } = await import('../../routes/viral.js');
    const m = buildDiscoveryManifest('http://localhost:3000');
    expect(m.server.name).toContain('syntaro-agent-discovery');
    expect(m.server.version).toBeDefined();
    expect(m.server.homepage).toMatch(/^https:\/\/github\.com/);
  });
  it('includes at least one transport', async () => {
    const { buildDiscoveryManifest } = await import('../../routes/viral.js');
    const m = buildDiscoveryManifest('http://localhost:3000');
    expect(m.transports.length).toBeGreaterThanOrEqual(1);
    expect(m.transports.map(t => t.type)).toContain('stdio');
  });
  it('registers all 6 tools', async () => {
    const { buildDiscoveryManifest } = await import('../../routes/viral.js');
    const m = buildDiscoveryManifest('http://localhost:3000');
    const names = m.tools.map(t => t.name);
    expect(names).toContain('syntaro_label_issue');
    expect(names).toContain('syntaro_run_fix');
    expect(names).toContain('syntaro_check_status');
    expect(names).toContain('syntaro_get_pr');
    expect(names).toContain('list_issues');
    expect(names).toContain('search_codebase');
    expect(m.tools.length).toBe(6);
  });
  it('each tool has an inputSchema', async () => {
    const { buildDiscoveryManifest } = await import('../../routes/viral.js');
    const m = buildDiscoveryManifest('http://localhost:3000');
    for (const tool of m.tools) {
      expect(tool.inputSchema).toBeDefined();
      expect(typeof tool.inputSchema).toBe('object');
    }
  });
  it('registers all 4 resources', async () => {
    const { buildDiscoveryManifest } = await import('../../routes/viral.js');
    const m = buildDiscoveryManifest('http://localhost:3000');
    const uris = m.resources.map(r => r.uri);
    expect(uris).toContain('syntaro://runs/{run_id}');
    expect(uris).toContain('syntaro://issues/{issue_id}');
    expect(uris).toContain('syntaro://status');
    expect(uris).toContain('syntaro://queue');
    expect(m.resources.length).toBe(4);
  });
  it('includes install configs', async () => {
    const { buildDiscoveryManifest } = await import('../../routes/viral.js');
    const m = buildDiscoveryManifest('http://localhost:3000');
    expect(m.install).toHaveProperty('opencode');
    expect(m.install).toHaveProperty('claudeDesktop');
  });
  it('injects base URL', async () => {
    const { buildDiscoveryManifest } = await import('../../routes/viral.js');
    const m = buildDiscoveryManifest('https://syntaro.example.com');
    for (const t of m.transports) {
      if ('url' in t && t.url) {
        expect(t.url).toMatch(/^https:\/\/syntaro\.example\.com/);
      }
    }
  });
  it('serialises to JSON', async () => {
    const { buildDiscoveryManifest } = await import('../../routes/viral.js');
    const m = buildDiscoveryManifest('http://localhost:3000');
    const s = JSON.stringify(m);
    expect(s).toBeTypeOf('string');
    expect(JSON.parse(s).schemaVersion).toBe('2024-11-05');
  });
});

describe('renderDiscoveryPage', () => {
  it('returns a complete HTML document', async () => {
    const { renderDiscoveryPage } = await import('../../routes/viral.js');
    const html = renderDiscoveryPage('http://localhost:3000');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
  });
  it('includes the discovery manifest link', async () => {
    const { renderDiscoveryPage } = await import('../../routes/viral.js');
    const html = renderDiscoveryPage('http://localhost:3000');
    expect(html).toContain('discovery/mcp.json');
    expect(html).toContain('syntaro://');
  });
  it('injects base URL', async () => {
    const { renderDiscoveryPage } = await import('../../routes/viral.js');
    const html = renderDiscoveryPage('https://syntaro.example.com');
    expect(html).toContain('https://syntaro.example.com');
  });
});
