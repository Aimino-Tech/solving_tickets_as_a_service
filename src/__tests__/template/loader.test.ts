import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearLoadedTemplates,
  getLoadedTemplate,
  getResolvedCommand,
  listLoadedTemplates,
  loadAndRegisterTemplates,
  scanTemplatesDirectory,
} from '../../template/loader.js';
import { templateRegistry } from '../../template/templateRegistry.js';

describe('template loader', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'syntaro-templates-'));
    clearLoadedTemplates();
    templateRegistry.clear();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function createTemplateFile(name: string, content: string): string {
    const path = join(tempDir, '.syntaro', 'templates');
    mkdirSync(path, { recursive: true });
    const filePath = join(path, name);
    writeFileSync(filePath, content, 'utf-8');
    return filePath;
  }

  it('scans and loads valid YAML templates', () => {
    createTemplateFile('fix.yaml', `
name: syntaro:fix
labels: [syntaro:fix, syntaro:bugfix]
phases:
  pre:
    - command: "opencode plan --issue {issue.number}"
      session: new
  main:
    - command: "opencode agent --full-cycle"
      session: new
  post:
    - command: "opencode remove-anti-slop"
      session: new
  final:
    - command: "opencode create-pr"
      session: new
`);

    const loaded = scanTemplatesDirectory(tempDir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe('syntaro:fix');
    expect(loaded[0].labels).toEqual(['syntaro:fix', 'syntaro:bugfix']);
    expect(Object.keys(loaded[0].phases)).toEqual(['pre', 'main', 'post', 'final']);
  });

  it('skips non-YAML files', () => {
    createTemplateFile('readme.md', '# not a template');
    createTemplateFile('fix.yaml', `
name: test
labels: [test]
phases:
  main:
    - command: "echo hello"
      session: new
`);

    const loaded = scanTemplatesDirectory(tempDir);
    expect(loaded).toHaveLength(1);
  });

  it('loads and registers templates', () => {
    createTemplateFile('fix.yaml', `
name: syntaro:fix
labels: [syntaro:fix]
phases:
  main:
    - command: "echo {issue.number}"
      session: new
`);
    createTemplateFile('plan.yaml', `
name: syntaro:plan
labels: [syntaro:plan]
phases:
  pre:
    - command: "opencode plan"
      session: new
`);

    loadAndRegisterTemplates(tempDir);
    const loaded = listLoadedTemplates();
    expect(loaded).toHaveLength(2);
    expect(templateRegistry.getJobTemplate('syntaro:fix')).toBeDefined();
    expect(templateRegistry.getJobTemplate('syntaro:plan')).toBeDefined();
  });

  it('resolves commands with placeholders', () => {
    createTemplateFile('fix.yaml', `
name: syntaro:fix
labels: [syntaro:fix]
phases:
  pre:
    - command: "opencode --issue {issue.number} --repo {repo.name}"
      session: new
`);

    scanTemplatesDirectory(tempDir);
    const resolved = getResolvedCommand('syntaro:fix', 'pre', 0, {
      'issue.number': 42,
      'repo.name': 'my-repo',
    });
    expect(resolved).toBe('opencode --issue 42 --repo my-repo');
  });

  it('leaves unresolved placeholders as-is', () => {
    createTemplateFile('fix.yaml', `
name: syntaro:fix
labels: [syntaro:fix]
phases:
  pre:
    - command: "opencode --issue {issue.number}"
      session: new
`);

    scanTemplatesDirectory(tempDir);
    const resolved = getResolvedCommand('syntaro:fix', 'pre', 0, {});
    expect(resolved).toBe('opencode --issue {issue.number}');
  });

  it('returns null for unknown template', () => {
    const resolved = getResolvedCommand('nonexistent', 'pre', 0, {});
    expect(resolved).toBeNull();
  });

  it('returns null for unknown phase', () => {
    createTemplateFile('fix.yaml', `
name: test
labels: [test]
phases:
  main:
    - command: "echo hello"
      session: new
`);

    scanTemplatesDirectory(tempDir);
    const resolved = getResolvedCommand('test', 'nonexistent', 0, {});
    expect(resolved).toBeNull();
  });

  it('returns null for out-of-range step', () => {
    createTemplateFile('fix.yaml', `
name: test
labels: [test]
phases:
  main:
    - command: "echo hello"
      session: new
`);

    scanTemplatesDirectory(tempDir);
    const resolved = getResolvedCommand('test', 'main', 5, {});
    expect(resolved).toBeNull();
  });
});
