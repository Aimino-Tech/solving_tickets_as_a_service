// STAS Conversation Eval — runner.
// Usage:
//   STAS_API_KEY=sk-stas_... GH_TOKEN=gho_... npx tsx eval/conversations/run.ts
// Options (env):
//   STAS_URL            STAS backend base (default http://localhost:3002)
//   STAS_API_KEY        per-user MCP API key (required)
//   GH_TOKEN            GitHub token (required)
//   EVAL_REPO_OWNER     default xdnaimino
//   EVAL_REPO_NAME      default stas-eval-sandbox
//   EVAL_CONVERSATIONS  number of conversations to run (default 10)
//   EVAL_TURNS          turns per conversation (default 10)
// Writes eval/results/conversations/<tag>.json; exit 0 iff all turns pass.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ConversationAgent } from './agent.js';
import { buildScenarios, title } from './scenarios.js';
import type { AgentReply, ConversationScript, EvalReport, TurnExpectation, TurnResult } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v && v.length > 0) return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required env var: ${name}`);
}

const stasUrl = env('STAS_URL', 'http://localhost:3002');
const stasApiKey = env('STAS_API_KEY');
const githubToken = env('GH_TOKEN');
const repoOwner = env('EVAL_REPO_OWNER', 'xdnaimino');
const repoName = env('EVAL_REPO_NAME', 'stas-eval-sandbox');
const convCount = Math.max(1, Number(env('EVAL_CONVERSATIONS', '10')));
const turnCount = Math.max(1, Number(env('EVAL_TURNS', '10')));
const mcpDelayMs = Math.max(0, Number(env('EVAL_MCP_DELAY_MS', '0')));
const tag = `ev${Date.now().toString(36)}`;

function check(replyText: string, flags: AgentReply['flags'], expect: TurnExpectation, errors: string[]): void {
  if (expect.action === 'fix') {
    if (expect.fixSubmitted && flags.fixesSubmitted < (expect.minFixes ?? 1)) {
      errors.push(`expected >=${expect.minFixes ?? 1} fix submissions, got ${flags.fixesSubmitted}`);
    }
    if (expect.ticketCreated && flags.ticketsCreated.length === 0) errors.push('expected a ticket to be created');
    if (expect.ticketExisted && flags.ticketsExisted.length === 0) errors.push('expected an existing ticket to be reported');
  }
  if (expect.action === 'check') {
    if (expect.ticketExisted && flags.ticketsExisted.length === 0) errors.push('expected an existing ticket to be reported');
    if (expect.replyIncludes?.some((s: string) => s === 'No ticket') && /Ticket exists/.test(replyText)) errors.push('expected NO existing ticket, agent reported one exists');
  }
  if (expect.action === 'create') {
    if (flags.ticketsCreated.length === 0) errors.push('expected a ticket to be created');
    if (flags.fixesSubmitted !== 0) errors.push('create-only turn must not submit fixes');
  }
  if (expect.action === 'status' && !flags.statusChecked) errors.push('expected a status check');
  if (expect.action === 'list' && flags.listedCount === 0) errors.push('expected tickets to be listed');
  for (const s of expect.replyIncludes ?? []) {
    if (!replyText.includes(s)) errors.push(`reply missing "${s}": ${replyText}`);
  }
  for (const s of expect.replyExcludes ?? []) {
    if (replyText.includes(s)) errors.push(`reply contains forbidden "${s}": ${replyText}`);
  }
}

async function runConversation(script: ConversationScript, agent: ConversationAgent): Promise<{ result: TurnResult[]; passed: number; failed: number }> {
  const results: TurnResult[] = [];
  let passed = 0;
  let failed = 0;
  for (let i = 0; i < script.turns.length; i++) {
    const turn = script.turns[i];
    const errors: string[] = [];
    let replyText = '';
    let replyActions: TurnResult['actions'] = [];
    let flags = { ticketsExisted: [] as number[], ticketsCreated: [] as number[], fixesSubmitted: 0, statusChecked: false, listedCount: 0 };
    try {
      const reply = await agent.handleUserMessage(turn.user);
      replyText = reply.text;
      replyActions = reply.actions;
      flags = reply.flags;
    } catch (e) {
      errors.push(`agent threw: ${e instanceof Error ? e.message : String(e)}`);
    }
    check(replyText, flags, turn.expect, errors);
    const verdict = errors.length === 0 ? 'pass' : 'fail';
    if (verdict === 'pass') passed += 1;
    else failed += 1;
    results.push({
      index: i,
      user: turn.user,
      reply: replyText,
      actions: replyActions,
      expectation: turn.expect,
      verdict,
      errors,
    });
    console.log(`  [conv ${script.id} turn ${i + 1}] ${verdict.toUpperCase()} — ${turn.user.slice(0, 80)}${errors.length ? `\n      ERRORS: ${errors.join('; ')}` : ''}`);
  }
  return { result: results, passed, failed };
}

async function main(): Promise<void> {
  console.log(`STAS Conversation Eval — tag=${tag}  repo=${repoOwner}/${repoName}  ${convCount} convs x ${turnCount} turns`);
  console.log(`  backend=${stasUrl}  agent=ConversationAgent(real GitHub + real STAS MCP)`);

  const scripts = buildScenarios(tag, { repoOwner, repoName }).slice(0, convCount);
  const agent = new ConversationAgent({ repoOwner, repoName, stasUrl, stasApiKey, githubToken, mcpDelayMs });

  const conversations: EvalReport['conversations'] = [];
  let totalPassed = 0;
  let totalFailed = 0;

  for (const script of scripts) {
    const trimmed: ConversationScript = { ...script, turns: script.turns.slice(0, turnCount) };
    console.log(`\n== Conversation ${trimmed.id}: ${trimmed.name} (${trimmed.turns.length} turns) ==`);
    const { result, passed, failed } = await runConversation(trimmed, agent);
    conversations.push({ id: trimmed.id, name: trimmed.name, turns: result, passed, failed });
    totalPassed += passed;
    totalFailed += failed;
  }

  const totalTurns = totalPassed + totalFailed;
  const report: EvalReport = {
    runId: tag,
    timestamp: new Date().toISOString(),
    repo: { owner: repoOwner, name: repoName },
    conversations,
    totals: {
      conversations: conversations.length,
      turns: totalTurns,
      passed: totalPassed,
      failed: totalFailed,
      passRate: totalTurns === 0 ? 0 : totalPassed / totalTurns,
    },
  };

  const outDir = resolve(__dirname, '..', '..', 'eval', 'results', 'conversations');
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, `${tag}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\n========================================`);
  console.log(`RESULT: ${totalPassed}/${totalTurns} turns passed (${(report.totals.passRate * 100).toFixed(1)}%)`);
  for (const c of conversations) {
    console.log(`  conv ${c.id} (${c.name}): ${c.passed}/${c.turns.length} passed${c.failed ? '  <-- FAILED' : ''}`);
  }
  console.log(`report: ${outPath}`);
  if (totalFailed > 0) process.exitCode = 1;
  else console.log('ALL CONVERSATIONS PASSED ✅');
}

main().catch((e) => {
  console.error('FATAL:', e instanceof Error ? e.stack ?? e.message : e);
  process.exitCode = 1;
});
