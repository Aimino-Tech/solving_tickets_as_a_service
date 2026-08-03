import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearLoadedTemplates, scanTemplatesDirectory } from '../../template/loader.js';
import { classifyByLabel, resolveTemplate } from '../../template/resolver.js';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

describe('classifyByLabel', () => {
  it('classifies syntaro:fix as bug', () => {
    const result = classifyByLabel(['syntaro:fix']);
    expect(result.type).toBe('bug');
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it('classifies syntaro:bugfix as bug', () => {
    const result = classifyByLabel(['syntaro:bugfix']);
    expect(result.type).toBe('bug');
  });

  it('classifies syntaro:feature as feature', () => {
    const result = classifyByLabel(['syntaro:feature']);
    expect(result.type).toBe('feature');
  });

  it('classifies syntaro:plan as planning', () => {
    const result = classifyByLabel(['syntaro:plan']);
    expect(result.type).toBe('planning');
  });

  it('classifies syntaro:research as research', () => {
    const result = classifyByLabel(['syntaro:research']);
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

  it('uses first matching syntaro: label', () => {
    const result = classifyByLabel(['not-matching', 'syntaro:fix']);
    expect(result.type).toBe('bug');
  });
});

describe('resolveTemplate', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'syntaro-resolver-'));
    clearLoadedTemplates();
    const templatesDir = join(tempDir, '.syntaro', 'templates');
    mkdirSync(templatesDir, { recursive: true });

    writeFileSync(join(templatesDir, 'fix.yaml'), `
name: syntaro:fix
labels: [syntaro:fix, syntaro:bugfix]
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
name: syntaro:plan
labels: [syntaro:plan]
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
    const classification = classifyByLabel(['syntaro:fix']);
    const match = resolveTemplate(classification, ['syntaro:fix']);

    expect(match.matchStrategy).toBe('exact');
    expect(match.template.name).toBe('syntaro:fix');
    expect(match.confidence).toBe(1.0);
  });

  it('resolves by prefix match', () => {
    const classification = classifyByLabel(['syntaro:fix:urgent']);
    const match = resolveTemplate(classification, ['syntaro:fix:urgent']);

    expect(match.template.name).toBe('syntaro:fix');
  });

  it('resolves by type inference when no label match', () => {
    const classification = classifyByLabel(['bug']);
    const match = resolveTemplate(classification, ['bug']);

    expect(match.template.name).toBe('syntaro:fix');
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
