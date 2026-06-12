#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';

export function checkRegression(baseline, current, threshold = 0.05) {
  const baselineRate = computePassRate(baseline.results);
  const currentRate = computePassRate(current.results);

  const baselinePct = (baselineRate * 100).toFixed(1);
  const currentPct = (currentRate * 100).toFixed(1);
  const diff = currentRate - baselineRate;

  const isRegression = currentRate < baselineRate - threshold;

  if (isRegression) {
    console.error(
      `REGRESSION DETECTED: pass rate ${currentPct}% vs baseline ${baselinePct}% ` +
      `(drop: ${(Math.abs(diff) * 100).toFixed(1)}pp, threshold: ${(threshold * 100).toFixed(0)}pp)`
    );
    return false;
  }

  console.log(
    `OK: pass rate ${currentPct}% vs baseline ${baselinePct}% ` +
    `(change: ${diff > 0 ? '+' : ''}${(diff * 100).toFixed(1)}pp, threshold: ${(threshold * 100).toFixed(0)}pp)`
  );
  return true;
}

function computePassRate(results) {
  if (!Array.isArray(results) || results.length === 0) return 0;
  const passed = results.filter(r => r.passed).length;
  return passed / results.length;
}

function loadJson(path) {
  if (!existsSync(path)) {
    console.error(`File not found: ${path}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function parseArgs() {
  const parsed = {};
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (i + 1 < process.argv.length && !process.argv[i + 1].startsWith('--')) {
        const value = process.argv[++i];
        const num = Number(value);
        parsed[key] = Number.isNaN(num) ? value : num;
      } else {
        parsed[key] = true;
      }
    }
  }
  return parsed;
}

if (process.argv.length > 2) {
  const args = parseArgs();
  const baselinePath = args.baseline;
  const currentPath = args.current;
  const threshold = args.threshold ?? 0.05;

  if (!baselinePath || !currentPath) {
    console.error('Usage: node check-regression.mjs --baseline <path> --current <path> [--threshold 0.05]');
    process.exit(1);
  }

  const baseline = loadJson(baselinePath);
  const current = loadJson(currentPath);

  const ok = checkRegression(baseline, current, threshold);
  process.exit(ok ? 0 : 1);
}
