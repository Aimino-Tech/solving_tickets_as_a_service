#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';

const ROOT = resolve(import.meta.dirname, '..');

const TIERS = [
  { tier: 1, variant: 'low', model: process.env.ROUTING_TIER1_MODEL || 'gpt-4o-mini', label: 'Cheap (routine)' },
  { tier: 2, variant: 'medium', model: process.env.ROUTING_TIER2_MODEL || 'gpt-4o-mini', label: 'Mid' },
  { tier: 3, variant: 'high', model: process.env.ROUTING_TIER3_MODEL || 'claude-sonnet-4', label: 'High' },
  { tier: 4, variant: 'max', model: process.env.ROUTING_TIER4_MODEL || 'claude-sonnet-4', label: 'Frontier (deep reasoning)' },
];

function runQualityGates(changedOnly) {
  const args = ['run', 'quality-gates'];
  if (changedOnly) args.push('--', '--changed-only');
  const res = spawnSync('npm', args, { cwd: ROOT, encoding: 'utf-8', shell: false });
  return { status: res.status ?? 1, stdout: res.stdout || '', stderr: res.stderr || '' };
}

function main() {
  const outputDir = resolve(ROOT, 'eval/results');
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
  const changedOnly = process.argv.includes('--changed-only');
  const tierArgIdx = process.argv.indexOf('--tiers');
  const selected = tierArgIdx >= 0 ? process.argv[tierArgIdx + 1].split(',').map(Number) : TIERS.map((t) => t.tier);
  const rows = [];

  for (const t of TIERS) {
    if (!selected.includes(t.tier)) continue;
    process.env.STAS_ROUTING_TIER = String(t.tier);
    process.env.STAS_ROUTING_VARIANT = t.variant;
    process.env.OPENCODE_MODEL = t.model;
    console.log(`[gates-per-tier] Tier ${t.tier} (${t.variant}) → ${t.model} — running quality gates...`);
    const result = runQualityGates(changedOnly);
    const passed = result.status === 0;
    rows.push({ ...t, passed, exitCode: result.status });
    console.log(`[gates-per-tier] Tier ${t.tier}: ${passed ? 'GREEN' : 'FAILED (exit ' + result.status + ')'}`);
    if (!passed) {
      const tail = result.stderr.split('\n').filter(Boolean).slice(-10).join('\n');
      console.log(tail || result.stdout.split('\n').filter(Boolean).slice(-10).join('\n'));
    }
  }

  const lines = [];
  lines.push('# Quality Gates — Per-Tier Run');
  lines.push('');
  lines.push('The 6 deterministic quality gates (reality, compile, test-integrity, hallucination, dead-code, external-AI-tool scan) are model-agnostic and must apply identically to cheap-routed fixes (Tier 1-2) and frontier fixes (Tier 3-4).');
  lines.push('');
  lines.push('| Tier | Variant | Model | Gates Result | Exit Code |');
  lines.push('|---|---|---|---|---|');
  for (const r of rows) {
    lines.push(`| ${r.tier} | ${r.variant} | ${r.model} | ${r.passed ? 'GREEN' : 'FAIL'} | ${r.exitCode} |`);
  }
  const allGreen = rows.every((r) => r.passed);
  lines.push('');
  lines.push(`**Overall: ${allGreen ? 'ALL TIERS GREEN ✅' : 'GAP DETECTED ❌ — see evidence above'}`);

  const outputPath = resolve(outputDir, 'gates-per-tier.md');
  writeFileSync(outputPath, lines.join('\n'), 'utf-8');
  console.log(`[gates-per-tier] Report written to ${outputPath}`);
  process.exit(allGreen ? 0 : 1);
}

main();
