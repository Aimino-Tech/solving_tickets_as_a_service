#!/usr/bin/env node

// =============================================================================
// STAS Benchmark Badge Generator
//
// Reads the aggregated full-report.json and generates an SVG badge showing
// the current eval pass rate.  The badge uses the "flat" style consistent
// with Shields.io output.
//
// Color ranges:
//   - green  (>= 90%)  — excellent
//   - yellow (>= 70%)  — acceptable
//   - orange (>= 50%)  — needs attention
//   - red    (< 50%)   — failing
//
// Usage:
//   node eval/scripts/badge-gen.mjs \
//     --input eval/results/full-report.json \
//     --output eval/badges/pass-rate.svg
//
// The badge is designed to be embedded in README.md or used as a Shields.io
// endpoint.
// =============================================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { input: '', output: 'eval/badges/pass-rate.svg' };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--input':
        opts.input = args[++i];
        break;
      case '--output':
        opts.output = args[++i];
        break;
      default:
        console.warn(`[badge-gen] Ignoring unknown option: ${args[i]}`);
    }
  }

  return opts;
}

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------
function getPassRateColor(rate) {
  if (rate >= 0.9) return '#4c1';      // green
  if (rate >= 0.7) return '#dfb317';   // yellow
  if (rate >= 0.5) return '#fe7d37';   // orange
  return '#e05d44';                     // red
}

function getRedTeamColor(passed) {
  return passed ? '#4c1' : '#e05d44';
}

function getTextColor() {
  return '#fff';
}

// ---------------------------------------------------------------------------
// SVG generation
// ---------------------------------------------------------------------------

/**
 * Generate a "flat"-style SVG badge matching Shields.io conventions.
 *
 * @param {string} label      - Left-side label text (e.g., "eval pass rate")
 * @param {string} value      - Right-side value text (e.g., "85%")
 * @param {string} valueColor - Background color for the value side (hex)
 * @param {object} options    - Optional: sublabel, link, etc.
 * @returns {string} SVG markup
 */
function generateBadge(label, value, valueColor, options = {}) {
  // Dimensions
  const labelFontSize = 11;
  const valueFontSize = 11;
  const height = 20;
  const labelPadding = 6;
  const valuePadding = 6;

  // Measure label width (approximate: avg char width ~ 6.5px for 11px font)
  const labelWidth = Math.ceil(label.length * 6.5) + labelPadding * 2;
  const valueWidth = Math.ceil(value.length * 6.5) + valuePadding * 2;
  const totalWidth = labelWidth + valueWidth;

  const labelTextX = labelPadding;
  const labelTextY = 14;
  const valueTextX = labelWidth + valuePadding;
  const valueTextY = 14;

  // Sublabel (small text below main value)
  const sublabel = options.sublabel || '';

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${totalWidth}" height="${height}">
  <linearGradient id="smooth" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <mask id="round">
    <rect width="${totalWidth}" height="${height}" rx="3" fill="#fff"/>
  </mask>
  <g mask="url(#round)">
    <rect width="${labelWidth}" height="${height}" fill="#555"/>
    <rect x="${labelWidth}" width="${valueWidth}" height="${height}" fill="${valueColor}"/>
    <rect width="${totalWidth}" height="${height}" fill="url(#smooth)"/>
  </g>
  <g fill="${getTextColor()}" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="${labelFontSize}">
    <text x="${labelWidth / 2}" y="${labelTextY}" fill="#010101" fill-opacity=".3">${escapeXml(label)}</text>
    <text x="${labelWidth / 2}" y="${labelTextY}">${escapeXml(label)}</text>
    <text x="${labelWidth + valueWidth / 2}" y="${valueTextY}" fill="#010101" fill-opacity=".3">${escapeXml(value)}</text>
    <text x="${labelWidth + valueWidth / 2}" y="${valueTextY}">${escapeXml(value)}</text>
  </g>
</svg>`;
}

/**
 * Generate a comprehensive benchmark badge showing multiple metrics.
 * This is the main badge used for the project README.
 */
function generateBenchmarkBadge(data) {
  // Extract data
  const evalPassRate = data?.summary?.evalPassRate ?? 0;
  const redTeamPassRate = data?.summary?.redTeamPassRate ?? 0;
  const redTeamPassed = data?.summary?.redTeamOverallPassed ?? false;
  const totalTests = data?.summary?.totalEvalTests ?? 0;
  const passedTests = data?.summary?.passedEvalTests ?? 0;

  const evalPercent = (evalPassRate * 100).toFixed(0);
  const redTeamPercent = (redTeamPassRate * 100).toFixed(0);

  const evalColor = getPassRateColor(evalPassRate);
  const redTeamColor = getRedTeamColor(redTeamPassed);

  // Calculate total width for all segments
  const segments = [
    { label: 'eval', width: 0 },
    { label: `${evalPercent}%`, width: 0, color: evalColor },
    { label: 'red team', width: 0 },
    { label: `${redTeamPercent}%`, width: 0, color: redTeamColor },
  ];

  const height = 20;
  const padding = 6;
  const charWidth = 6.5;
  const gapWidth = 1; // gap between segments

  for (const seg of segments) {
    seg.width = Math.ceil(seg.label.length * charWidth) + padding * 2;
  }

  const totalWidth = segments.reduce((sum, seg) => sum + seg.width, 0) + gapWidth * (segments.length - 1);

  // Build SVG
  let currentX = 0;
  const rects = [];
  const texts = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const isEven = i % 2 === 0; // labels on gray, values on color
    const bgColor = seg.color || '#555';

    if (i > 0) {
      currentX += gapWidth;
    }

    rects.push(`    <rect x="${currentX}" width="${seg.width}" height="${height}" fill="${bgColor}"/>`);

    const textX = currentX + seg.width / 2;
    texts.push(`    <text x="${textX}" y="14" fill="#010101" fill-opacity=".3" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11">${escapeXml(seg.label)}</text>`);
    texts.push(`    <text x="${textX}" y="14" fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11">${escapeXml(seg.label)}</text>`);

    currentX += seg.width;
  }

  const finalWidth = currentX;

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${finalWidth}" height="${height}">
  <linearGradient id="smooth" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <mask id="round">
    <rect width="${finalWidth}" height="${height}" rx="3" fill="#fff"/>
  </mask>
  <g mask="url(#round)">
${rects.join('\n')}
    <rect width="${finalWidth}" height="${height}" fill="url(#smooth)"/>
  </g>
  <g fill="#fff">
${texts.join('\n')}
  </g>
</svg>`;
}

/**
 * Generate a simple single-metric badge (for granular use).
 */
function generateSingleBadge(data) {
  const evalPassRate = data?.summary?.evalPassRate ?? 0;
  const evalPercent = (evalPassRate * 100).toFixed(0);
  const color = getPassRateColor(evalPassRate);

  return generateBadge('eval pass rate', `${evalPercent}%`, color);
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------
function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const opts = parseArgs();

  if (!opts.input) {
    console.error('[badge-gen] Error: --input is required');
    console.error('Usage: badge-gen.mjs --input <report.json> --output <badge.svg>');
    process.exit(1);
  }

  if (!existsSync(opts.input)) {
    console.error(`[badge-gen] Error: Input file not found: ${opts.input}`);
    console.error('Run full-report.mjs first to generate the input JSON.');
    process.exit(1);
  }

  // Read the aggregated report
  let data;
  try {
    const raw = readFileSync(opts.input, 'utf-8');
    data = JSON.parse(raw);
  } catch (err) {
    console.error(`[badge-gen] Error: Failed to parse input file: ${err.message}`);
    process.exit(1);
  }

  // Generate both badge styles
  const benchmarkBadge = generateBenchmarkBadge(data);
  // const singleBadge = generateSingleBadge(data);

  // Ensure output directory exists
  const outputDir = opts.output.substring(0, opts.output.lastIndexOf('/'));
  if (outputDir && !existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // Write the main benchmark badge
  writeFileSync(opts.output, benchmarkBadge, 'utf-8');
  console.log(`[badge-gen] Benchmark badge written to ${opts.output}`);

  // Extract and log the pass rate
  const evalPassRate = data?.summary?.evalPassRate ?? 0;
  const redTeamPassed = data?.summary?.redTeamOverallPassed ?? false;
  console.log(`[badge-gen] Eval pass rate: ${(evalPassRate * 100).toFixed(1)}%`);
  console.log(`[badge-gen] Red team: ${redTeamPassed ? 'PASSED' : 'FAILED'}`);
  console.log(`[badge-gen] Badge color: ${getPassRateColor(evalPassRate)}`);
}

main();
