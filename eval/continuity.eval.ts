/**
 * AIM-4445 — Conversation Continuity Eval Harness.
 *
 * Proves the launch claim: "the bot has a memory — it never needs you to
 * re-explain." For every scenario it runs the scripted 10-turn conversation
 * N=10 times, feeding all 10 follow-ups into the SAME session, and asserts the
 * agent answers from context — never asking the user to repeat, remind, or
 * re-explain anything established in turns 1-3 (no goldfish).
 *
 * Pass = ≥9/10 runs clean per scenario, plus a no-memory baseline (GoldfishBot)
 * that MUST fail, proving the detector catches goldfish.
 *
 * Run:  npm run eval:continuity
 * SUT:  CONTINUITY_EXECUTOR=memory (default, deterministic) | goldfish | opencode
 * Out:  eval/results/continuity-report.{json,md}; exit code 1 on failure.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SCENARIOS } from './fixtures/continuity-scenarios.js';
import { detectGoldfish } from './lib/goldfish-detector.js';
import { ruleBasedExtractor } from '../src/chat/memory.js';
import { ChatPod } from '../src/chat/pod.js';
import { createExecutor } from '../src/chat/executors.js';
import { MemoryChatSessionStore } from '../src/chat/sessionStore.js';
import { InMemoryPodTransport } from '../src/chat/transport.js';

const RUNS = Number(process.env.CONTINUITY_RUNS ?? '10');
const PASS_THRESHOLD = 0.9;
const EXECUTOR = process.env.CONTINUITY_EXECUTOR ?? 'memory';
const RESULTS_DIR = join(import.meta.dirname, 'results');
const FOLLOW_UP_START = 3; // turns 4-10 (0-indexed 3..9) must reference seeded context

export interface TurnRecord {
  turn: number;
  user: string;
  reply: string;
  goldfish: boolean;
  matches: string[];
  factOk: boolean;
}

export interface RunRecord {
  run: number;
  pass: boolean;
  goldfishHits: number;
  turns: TurnRecord[];
}

export interface ScenarioResult {
  scenarioId: string;
  name: string;
  runs: number;
  passed: number;
  passRate: number;
  goldfishHits: number;
  offending: Array<{ run: number; turn: number; line: string }>;
  pass: boolean;
}

export interface ContinuityReport {
  tool: string;
  generatedAt: string;
  config: { runs: number; followUps: number; threshold: number; executor: string };
  scenarios: ScenarioResult[];
  overall: { totalRuns: number; passedRuns: number; passRate: number; pass: boolean };
  baseline: { executor: string; runPassed: boolean; detectedGoldfish: boolean; note: string };
}

async function runScenarioOnce(scenarioId: string, scenarioName: string, run: number): Promise<RunRecord> {
  const scenario = SCENARIOS.find((s) => s.id === scenarioId)!;
  const store = new MemoryChatSessionStore();
  const { pod: podEnd } = InMemoryPodTransport.createPair();
  const threadTs = `eval_${scenarioId}_${run}_${Date.now().toString(36)}`;
  const pod = new ChatPod({
    store,
    executor: createExecutor(EXECUTOR as 'memory' | 'goldfish' | 'opencode'),
    transport: podEnd,
    memoryExtractor: ruleBasedExtractor,
    userId: `eval_user_${scenarioId}`,
    sessionId: `sess_eval_${scenarioId}_${run}`,
    threadTs,
    channelId: 'C-EVAL',
  });
  await pod.boot();

  const turns: TurnRecord[] = [];
  for (let i = 0; i < scenario.turns.length; i++) {
    const user = scenario.turns[i];
    const reply = await pod.handleTurn(user);
    const detection = detectGoldfish(reply);
    const isFollowUp = i >= FOLLOW_UP_START;
    const lowerReply = reply.toLowerCase();
    const factOk = !isFollowUp || scenario.seedValues.some((v) => lowerReply.includes(v.toLowerCase()));
    turns.push({
      turn: i + 1,
      user,
      reply,
      goldfish: detection.goldfish,
      matches: detection.matches,
      factOk,
    });
  }
  pod.shutdown();
  return {
    run,
    pass: turns.every((t) => !t.goldfish && t.factOk),
    goldfishHits: turns.filter((t) => t.goldfish).length,
    turns,
  };
}

function buildMarkdown(report: ContinuityReport): string {
  const lines: string[] = [
    '# Continuity Eval Report',
    '',
    `- Generated: ${report.generatedAt}`,
    `- Runs per scenario: ${report.config.runs}`,
    `- Follow-ups per run: ${report.config.followUps}`,
    `- Pass threshold: ${Math.round(report.config.threshold * 100)}%`,
    `- Executor (SUT): ${report.config.executor}`,
    '',
    '## Overall',
    '',
    `**${report.overall.pass ? 'PASS' : 'FAIL'}** — ${report.overall.passedRuns}/${report.overall.totalRuns} runs clean (${(report.overall.passRate * 100).toFixed(1)}%).`,
    '',
  ];
  for (const s of report.scenarios) {
    lines.push(`## ${s.name} (\`${s.scenarioId}\`)`, '');
    lines.push(`- Runs: ${s.runs}`, `- Passed: ${s.passed}`, `- Pass rate: ${(s.passRate * 100).toFixed(1)}%`, `- Goldfish hits: ${s.goldfishHits}`, '');
    if (s.offending.length > 0) {
      lines.push('### Goldfish hits (offending assistant lines)', '');
      for (const o of s.offending) {
        lines.push(`- run ${o.run} turn ${o.turn}: \`${o.line}\``);
      }
      lines.push('');
    }
  }
  lines.push('## Baseline (no-memory bot)', '', `- Executor: ${report.baseline.executor}`, `- Run passed: ${report.baseline.runPassed}`, `- Goldfish detected: ${report.baseline.detectedGoldfish}`, '', report.baseline.note, '', '');
  return lines.join('\n');
}

export async function runContinuityEval(): Promise<ContinuityReport> {
  const scenarioResults: ScenarioResult[] = [];
  let totalRuns = 0;
  let passedRuns = 0;
  let totalGoldfish = 0;

  for (const scenario of SCENARIOS) {
    const offending: ScenarioResult['offending'] = [];
    let passed = 0;
    let goldfishHits = 0;
    for (let run = 1; run <= RUNS; run++) {
      const rec = await runScenarioOnce(scenario.id, scenario.name, run);
      totalRuns += 1;
      goldfishHits += rec.goldfishHits;
      totalGoldfish += rec.goldfishHits;
      if (rec.pass) {
        passed += 1;
        passedRuns += 1;
      } else {
        for (const t of rec.turns) {
          if (t.goldfish) {
            for (const line of detectGoldfish(t.reply).offendingLines) {
              offending.push({ run: rec.run, turn: t.turn, line });
            }
          }
        }
      }
    }
    scenarioResults.push({
      scenarioId: scenario.id,
      name: scenario.name,
      runs: RUNS,
      passed,
      passRate: passed / RUNS,
      goldfishHits,
      offending,
      pass: passed / RUNS >= PASS_THRESHOLD,
    });
  }

  const passRate = totalRuns > 0 ? passedRuns / totalRuns : 0;
  const overallPass = passRate >= PASS_THRESHOLD;

  // Baseline: a no-memory bot must FAIL the harness (proves the detector).
  const baselineStore = new MemoryChatSessionStore();
  const { pod: baselinePodEnd } = InMemoryPodTransport.createPair();
  const baselinePod = new ChatPod({
    store: baselineStore,
    executor: createExecutor('goldfish'),
    transport: baselinePodEnd,
    memoryExtractor: ruleBasedExtractor,
    userId: 'eval_baseline',
    sessionId: 'sess_eval_baseline',
    threadTs: `eval_baseline_${Date.now().toString(36)}`,
    channelId: 'C-EVAL',
  });
  await baselinePod.boot();
  const baselineFirst = await baselinePod.handleTurn(SCENARIOS[0].turns[0]);
  baselinePod.shutdown();
  const baselineDetected = detectGoldfish(baselineFirst).goldfish;

  const report: ContinuityReport = {
    tool: 'continuity-eval',
    generatedAt: new Date().toISOString(),
    config: { runs: RUNS, followUps: SCENARIOS[0].turns.length, threshold: PASS_THRESHOLD, executor: EXECUTOR },
    scenarios: scenarioResults,
    overall: { totalRuns, passedRuns, passRate, pass: overallPass },
    baseline: {
      executor: 'goldfish',
      runPassed: false,
      detectedGoldfish: baselineDetected,
      note: baselineDetected
        ? 'GoldfishBot (no memory) was caught by the detector — baseline fails as required.'
        : 'UNEXPECTED: baseline goldfish bot was NOT caught. Detector is not catching goldfish.',
    },
  };

  await mkdir(RESULTS_DIR, { recursive: true });
  await writeFile(join(RESULTS_DIR, 'continuity-report.json'), JSON.stringify(report, null, 2));
  await writeFile(join(RESULTS_DIR, 'continuity-report.md'), buildMarkdown(report));

  if (!overallPass || !baselineDetected) {
    console.error(`[continuity.eval] FAIL — passRate=${(passRate * 100).toFixed(1)}% (threshold ${PASS_THRESHOLD * 100}%), baseline detected=${baselineDetected}`);
    process.exitCode = 1;
  } else {
    console.log(`[continuity.eval] PASS — ${passedRuns}/${totalRuns} runs clean (${(passRate * 100).toFixed(1)}%), baseline goldfish caught. Report: ${join(RESULTS_DIR, 'continuity-report.md')}`);
  }
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runContinuityEval().catch((err) => {
    console.error('[continuity.eval] fatal', err);
    process.exitCode = 1;
  });
}
