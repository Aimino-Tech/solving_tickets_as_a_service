import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearLoadedTemplates, scanTemplatesDirectory } from '../../template/loader.js';
import { classifyByLabel, resolveTemplate } from '../../template/resolver.js';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

describe('classifyByLabel', () => {
  it('classifies stas:fix as bug', () => {
    const result = classifyByLabel(['stas:fix']);
    expect(result.type).toBe('bug');
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it('classifies stas:bugfix as bug', () => {
    const result = classifyByLabel(['stas:bugfix']);
    expect(result.type).toBe('bug');
  });

  it('classifies stas:feature as feature', () => {
    const result = classifyByLabel(['stas:feature']);
    expect(result.type).toBe('feature');
  });

  it('classifies stas:plan as planning', () => {
    const result = classifyByLabel(['stas:plan']);
    expect(result.type).toBe('planning');
  });

  it('classifies stas:research as research', () => {
    const result = classifyByLabel(['stas:research']);
    expect(result.type).toBe('research');
  });

  it('classifies generic bug label', () => {
    const result = classifyByLabel(['bug']);
    expect(result.type).toBe('bug');
  });

  it('returns unknown for unrecognized labels', () => {
    const result = classifyByLabel(['random-label']);
    expect(result.type).toBe('unknown');
    expect(result.confidence).toBeLessThan(0.5);
  });

  it('uses first matching stas: label', () => {
    const result = classifyByLabel(['not-matching', 'stas:fix']);
    expect(result.type).toBe('bug');
  });
});

describe('resolveTemplate', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'stas-resolver-'));
    clearLoadedTemplates();
    const templatesDir = join(tempDir, '.stas', 'templates');
    mkdirSync(templatesDir, { recursive: true });

    writeFileSync(join(templatesDir, 'fix.yaml'), `
name: stas:fix
labels: [stas:fix, stas:bugfix]
phases:
  pre:
    - command: "opencode plan"
      session: new
  main:
    - command: "opencode agent"
      session: new
  post:
    - command: "opencode cleanup"
      session: new
  final:
    - command: "opencode pr"
      session: new
`);

    writeFileSync(join(templatesDir, 'plan.yaml'), `
name: stas:plan
labels: [stas:plan]
phases:
  pre:
    - command: "opencode research"
      session: new
  main:
    - command: "opencode design"
      session: new
`);

    writeFileSync(join(templatesDir, 'default.yaml'), `
name: default
labels: [default]
phases:
  main:
    - command: "echo default"
      session: new
`);

    scanTemplatesDirectory(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('resolves by exact label match', () => {
    const classification = classifyByLabel(['stas:fix']);
    const match = resolveTemplate(classification, ['stas:fix']);

    expect(match.matchStrategy).toBe('exact');
    expect(match.template.name).toBe('stas:fix');
    expect(match.confidence).toBe(1.0);
  });

  it('resolves by prefix match', () => {
    const classification = classifyByLabel(['stas:fix:urgent']);
    const match = resolveTemplate(classification, ['stas:fix:urgent']);

    expect(match.template.name).toBe('stas:fix');
  });

  it('resolves by type inference when no label match', () => {
    const classification = classifyByLabel(['bug']);
    const match = resolveTemplate(classification, ['bug']);

    expect(match.template.name).toBe('stas:fix');
  });

  it('falls back to default when nothing matches', () => {
    const classification = classifyByLabel(['unknown-label']);
    const match = resolveTemplate(classification, ['unknown-label']);

    expect(match.matchStrategy).toBe('fallback');
    expect(match.template.name).toBe('default');
  });

  it('returns a fallback even when no default template exists', () => {
    clearLoadedTemplates();

    const classification = classifyByLabel(['unknown']);
    const match = resolveTemplate(classification, ['unknown']);

    expect(match.template.name).toBe('default');
    expect(match.matchStrategy).toBe('fallback');
  });
});
