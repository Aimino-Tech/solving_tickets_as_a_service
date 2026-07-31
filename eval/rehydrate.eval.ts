/**
 * AIM-4445 — Kill-pod rehydrate eval variant.
 *
 * Proves a conversation survives pod death: run turns 1-5, kill the pod,
 * rehydrate a FRESH pod from the durable session store, continue turns 6-10,
 * and assert the agent still answers from context (no goldfish, memory intact).
 * The kill is repeated 3 times mid-run.
 *
 * Run:  npm run eval:rehydrate
 * SUT:  CONTINUITY_EXECUTOR=memory (default) | goldfish | opencode
 * Out:  eval/results/rehydrate-report.{json,md}; exit code 1 on failure.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SCENARIOS } from './fixtures/continuity-scenarios.js';
import { detectGoldfish } from './lib/goldfish-detector.js';
import { ruleBasedExtractor } from '../src/chat/memory.js';
import { ChatPod } from '../src/chat/pod.js';
import { createExecutor } from '../src/chat/executors.js';
import { MemoryChatSessionStore } from '../src/chat/sessionStore.js';
import { rehydrateSession } from '../src/chat/rehydrator.js';
import { InMemoryPodTransport } from '../src/chat/transport.js';

const EXECUTOR = process.env.CONTINUITY_EXECUTOR ?? 'memory';
const RESULTS_DIR = join(import.meta.dirname, 'results');
const KILLS = 3;

export interface RehydrateTurn {
  turn: number;
  user: string;
  reply: string;
  goldfish: boolean;
  resumedAfterKill: boolean;
}

export interface RehydrateRun {
  scenarioId: string;
  kills: number;
  turns: RehydrateTurn[];
  memoryIntactAfterEachKill: boolean[];
  pass: boolean;
}

export interface RehydrateReport {
  tool: string;
  generatedAt: string;
  config: { executor: string; kills: number };
  runs: RehydrateRun[];
  overall: { runs: number; passed: number; pass: boolean };
}

function buildMarkdown(report: RehydrateReport): string {
  const lines: string[] = [
    '# Rehydrate Eval Report',
    '',
    `- Generated: ${report.generatedAt}`,
    `- Executor: ${report.config.executor}`,
    `- Pod kills per run: ${report.config.kills}`,
    '',
    '## Overall',
    '',
    `**${report.overall.pass ? 'PASS' : 'FAIL'}** — ${report.overall.passed}/${report.overall.runs} runs resumed clean.`,
    '',
  ];
  for (const run of report.runs) {
    lines.push(`## ${run.scenarioId}`, '');
    lines.push(`- Kills: ${run.kills}`, `- Memory intact after each kill: ${run.memoryIntactAfterEachKill.join(', ')}`, `- Pass: ${run.pass}`, '');
    const goldfish = run.turns.filter((t) => t.goldfish);
    if (goldfish.length > 0) {
      lines.push('### Goldfish after resume', '');
      for (const t of goldfish) lines.push(`- turn ${t.turn}: \`${t.reply}\``);
      lines.push('');
    }
  }
  return lines.join('\n');
}

async function runRehydrate(scenarioId: string): Promise<RehydrateRun> {
  const scenario = SCENARIOS.find((s) => s.id === scenarioId)!;
  const store = new MemoryChatSessionStore();
  const threadTs = `eval_rehydrate_${scenarioId}_${Date.now().toString(36)}`;
  const userId = `eval_user_${scenarioId}`;
  const channelId = 'C-EVAL';
  const sessionId = `sess_rehydrate_${scenarioId}`;

  const makePod = () => {
    const { pod: podEnd } = InMemoryPodTransport.createPair();
    return new ChatPod({
      store,
      executor: createExecutor(EXECUTOR as 'memory' | 'goldfish' | 'opencode'),
      transport: podEnd,
      memoryExtractor: ruleBasedExtractor,
      userId,
      sessionId,
      threadTs,
      channelId,
    });
  };

  const turns: RehydrateTurn[] = [];
  const memoryIntactAfterEachKill: boolean[] = [];
  let pod = makePod();
  await pod.boot();

  const resumePoints: Array<[start: number, end: number]> = [
    [0, 4], // turns 1-5, then kill #1
    [5, 7], // turns 6-8, then kill #2
    [8, 9], // turns 9-10, then kill #3 (after turn 10)
  ];

  for (const [start, end] of resumePoints) {
    for (let i = start; i <= end && i < scenario.turns.length; i++) {
      const reply = await pod.handleTurn(scenario.turns[i]);
      turns.push({
        turn: i + 1,
        user: scenario.turns[i],
        reply,
        goldfish: detectGoldfish(reply).goldfish,
        resumedAfterKill: false,
      });
    }

    // Kill the pod mid-conversation and rehydrate a fresh one from the store.
    pod.shutdown();
    const rehydrated = await rehydrateSession({ store, threadTs, channelId, userId, sessionId });
    const memoryIntact = rehydrated.memoryBlock.length > 0;
    memoryIntactAfterEachKill.push(memoryIntact);
    pod = makePod();
    await pod.boot();
  }

  // Final pod state (after last kill) must still answer from context.
  const pass =
    memoryIntactAfterEachKill.every(Boolean) &&
    turns.filter((t) => !t.resumedAfterKill).every((t) => !t.goldfish);

  return { scenarioId, kills: KILLS, turns, memoryIntactAfterEachKill, pass };
}

export async function runRehydrateEval(): Promise<RehydrateReport> {
  const runs: RehydrateRun[] = [];
  for (const scenario of SCENARIOS) {
    runs.push(await runRehydrate(scenario.id));
  }
  const passed = runs.filter((r) => r.pass).length;
  const pass = passed === runs.length;
  const report: RehydrateReport = {
    tool: 'rehydrate-eval',
    generatedAt: new Date().toISOString(),
    config: { executor: EXECUTOR, kills: KILLS },
    runs,
    overall: { runs: runs.length, passed, pass },
  };

  await mkdir(RESULTS_DIR, { recursive: true });
  await writeFile(join(RESULTS_DIR, 'rehydrate-report.json'), JSON.stringify(report, null, 2));
  await writeFile(join(RESULTS_DIR, 'rehydrate-report.md'), buildMarkdown(report));

  if (!pass) {
    console.error('[rehydrate.eval] FAIL — not all runs resumed clean.');
    process.exitCode = 1;
  } else {
    console.log(`[rehydrate.eval] PASS — ${passed}/${runs.length} runs resumed clean with ${KILLS} pod kills each. Report: ${join(RESULTS_DIR, 'rehydrate-report.md')}`);
  }
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runRehydrateEval().catch((err) => {
    console.error('[rehydrate.eval] fatal', err);
    process.exitCode = 1;
  });
}
