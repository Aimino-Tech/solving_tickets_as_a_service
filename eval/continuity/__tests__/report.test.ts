import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HarnessSummary } from '../lib/runner.js';
import { buildReport, renderMarkdown, writeReport } from '../report.js';

const tmpDirs: string[] = [];

function summary(overrides: Partial<HarnessSummary> = {}): HarnessSummary {
  return {
    scenarioId: 'scenario-1',
    sutName: 'test-sut',
    numRuns: 2,
    passedRuns: 2,
    passRate: 1,
    passed: true,
    runs: [
      { scenarioId: 'scenario-1', runIndex: 0, passed: true, goldfishTurns: [], turnOutcomes: [] },
      { scenarioId: 'scenario-1', runIndex: 1, passed: true, goldfishTurns: [], turnOutcomes: [] },
    ],
    ...overrides,
  };
}

afterEach(async () => {
  for (const dir of tmpDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function makeTmpDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'continuity-report-'));
  tmpDirs.push(dir);
  return dir;
}

describe('buildReport', () => {
  it('sets suite name and threshold', () => {
    const report = buildReport('my-suite', [summary()]);
    expect(report.suite).toBe('my-suite');
    expect(report.passRateThreshold).toBe(0.9);
  });

  it('sets passed true when all scenarios pass', () => {
    const report = buildReport('s', [summary(), summary({ scenarioId: 'scenario-2' })]);
    expect(report.passed).toBe(true);
  });

  it('sets passed false when any scenario fails', () => {
    const report = buildReport('s', [summary(), summary({ passed: false, passedRuns: 1, passRate: 0.5 })]);
    expect(report.passed).toBe(false);
  });

  it('includes createdAt as an ISO string and the scenarios', () => {
    const scenarios = [summary()];
    const report = buildReport('s', scenarios);
    expect(new Date(report.createdAt).toISOString()).toBe(report.createdAt);
    expect(report.scenarios).toBe(scenarios);
  });
});

describe('renderMarkdown', () => {
  it('renders a heading and table header', () => {
    const md = renderMarkdown(buildReport('continuity-x', [summary()]));
    expect(md).toContain('# Continuity eval: continuity-x');
    expect(md).toContain('| Scenario | SUT | Runs passed | Pass rate | Result |');
  });

  it('renders one row per scenario with PASS/FAIL', () => {
    const report = buildReport('s', [
      summary(),
      summary({ scenarioId: 'bad', passed: false, passedRuns: 1, passRate: 0.5 }),
    ]);
    const md = renderMarkdown(report);
    expect(md).toContain('| scenario-1 | test-sut | 2/2 | 100% | PASS |');
    expect(md).toContain('| bad | test-sut | 1/2 | 50% | FAIL |');
  });

  it('prints Overall: PASS when passed and Overall: FAIL otherwise', () => {
    expect(renderMarkdown(buildReport('s', [summary()]))).toContain('Overall: PASS');
    const failing = buildReport('s', [summary({ passed: false })]);
    expect(renderMarkdown(failing)).toContain('Overall: FAIL');
  });

  it('mentions failed run index and goldfish turns for failing runs', () => {
    const scenarios = [
      summary({
        scenarioId: 'goldy',
        passed: false,
        passedRuns: 1,
        runs: [
          { scenarioId: 'goldy', runIndex: 2, passed: false, goldfishTurns: [4, 7], turnOutcomes: [] },
          { scenarioId: 'goldy', runIndex: 3, passed: true, goldfishTurns: [], turnOutcomes: [] },
        ],
      }),
    ];
    const md = renderMarkdown(buildReport('s', scenarios));
    expect(md).toContain('Run 2 of goldy failed on turns: 4, 7');
  });

  it('does not mention failing runs when all runs pass', () => {
    const md = renderMarkdown(buildReport('s', [summary()]));
    expect(md).not.toMatch(/Run \d+ of /);
  });
});

describe('writeReport', () => {
  it('writes parseable JSON and matching markdown into the results dir', async () => {
    const dir = await makeTmpDir();
    const report = buildReport('s', [summary()]);
    const jsonPath = await writeReport(report, 'report', dir);

    expect(jsonPath).toBe(join(dir, 'report.json'));
    const json = JSON.parse(await readFile(join(dir, 'report.json'), 'utf8'));
    expect(json).toEqual(report);
    expect(await readFile(join(dir, 'report.md'), 'utf8')).toBe(renderMarkdown(report));
  });

  it('uses the filename argument for both files', async () => {
    const dir = await makeTmpDir();
    const report = buildReport('s', [summary()]);
    await writeReport(report, 'myreport', dir);

    const json = JSON.parse(await readFile(join(dir, 'myreport.json'), 'utf8'));
    expect(json).toEqual(report);
    expect(await readFile(join(dir, 'myreport.md'), 'utf8')).toBe(renderMarkdown(report));
    await expect(readFile(join(dir, 'report.json'), 'utf8')).rejects.toThrow();
  });
});
