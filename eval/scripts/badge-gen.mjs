#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

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

function loadJson(path) {
  if (!existsSync(path)) {
    console.error(`File not found: ${path}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
}

export function generateBadgeSvg(passRate, total, passed, failed, errored) {
  const pct = Math.round(passRate * 100);
  const color = pct >= 80 ? '#2ea44f' : pct >= 50 ? '#e09100' : '#cf222e';
  const label = `Eval: ${pct}%`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="20" role="img" aria-label="Eval: ${pct}%">
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r">
    <rect width="140" height="20" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="70" height="20" fill="#555"/>
    <rect x="70" width="70" height="20" fill="${color}"/>
    <rect width="140" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="35" y="15" fill="#010101" fill-opacity=".3">eval</text>
    <text x="35" y="14">eval</text>
    <text x="105" y="15" fill="#010101" fill-opacity=".3">${pct}%</text>
    <text x="105" y="14">${pct}%</text>
  </g>
</svg>`;

  return svg;
}

export function generateDetailedBadgeSvg(passRate, total, passed, failed, errored) {
  const pct = Math.round(passRate * 100);
  const color = pct >= 80 ? '#2ea44f' : pct >= 50 ? '#e09100' : '#cf222e';
  const line1 = `Eval: ${pct}%`;
  const line2 = `${passed}/${total} passed`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="40" role="img" aria-label="Eval: ${pct}% — ${passed}/${total} passed">
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r">
    <rect width="220" height="40" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="110" height="40" fill="#555"/>
    <rect x="110" width="110" height="40" fill="${color}"/>
    <rect width="220" height="40" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="55" y="16" fill="#010101" fill-opacity=".3">eval</text>
    <text x="55" y="15">eval</text>
    <text x="165" y="16" fill="#010101" fill-opacity=".3">${pct}%</text>
    <text x="165" y="15">${pct}%</text>
    <text x="110" y="33" fill="#010101" fill-opacity=".3">${passed}/${total} passed</text>
    <text x="110" y="32">${passed}/${total} passed</text>
  </g>
</svg>`;

  return svg;
}

function main() {
  const args = parseArgs();
  const inputPath = args.input;
  const outputPath = args.output;
  const variant = args.variant || 'simple';

  if (!inputPath || !outputPath) {
    console.error('Usage: node badge-gen.mjs --input <path> --output <path> [--variant simple|detailed]');
    process.exit(1);
  }

  const data = loadJson(inputPath);

  let total, passed, failed, errored, passRate;

  if (data.summary) {
    total = data.summary.total;
    passed = data.summary.passed;
    failed = data.summary.failed;
    errored = data.summary.errored;
    passRate = data.summary.passRate;
  } else if (data.results && Array.isArray(data.results)) {
    total = data.results.length;
    passed = data.results.filter(r => r.passed).length;
    failed = data.results.filter(r => !r.passed && !r.error).length;
    errored = data.results.filter(r => r.error).length;
    passRate = total > 0 ? passed / total : 0;
  } else {
    console.error('Unrecognized input format: expected object with summary or results array');
    process.exit(1);
  }

  const svg = variant === 'detailed'
    ? generateDetailedBadgeSvg(passRate, total, passed, failed, errored)
    : generateBadgeSvg(passRate, total, passed, failed, errored);

  const outDir = dirname(outputPath);
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  writeFileSync(outputPath, svg, 'utf-8');
  const badgePct = Math.round(passRate * 100);
  console.log(`Badge written to ${outputPath} (${variant}, ${badgePct}%)`);
}

if (process.argv.length > 2) {
  main();
}
