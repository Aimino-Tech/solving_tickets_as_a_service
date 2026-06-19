#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = resolve(__dirname, '..', 'results');
const AGGREGATED_PATH = resolve(RESULTS_DIR, 'aggregated.json');

function parseResultFile(filePath) {
  const raw = readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

function aggregate() {
  const files = readdirSync(RESULTS_DIR)
    .filter(f => f.startsWith('standard-') && f.endsWith('.json') && f !== 'aggregated.json')
    .sort();

  if (files.length === 0) {
    console.error('No standard-*.json result files found in', RESULTS_DIR);
    process.exit(1);
  }

  const allResults = [];
  const allErrors = [];
  const allFailures = [];
  let passCount = 0;
  let failCount = 0;
  let errorCount = 0;

  for (const file of files) {
    const filePath = resolve(RESULTS_DIR, file);
    const data = parseResultFile(filePath);
    const groupName = basename(file, '.json');

    if (data.results && Array.isArray(data.results)) {
      for (const result of data.results) {
        const passed = !!result.passed;
        const errored = !!result.error;
        const failed = !passed && !errored;

        allResults.push({
          group: groupName,
          testName: result.name || result.id || 'unnamed',
          passed,
          error: result.error || null,
          failure: result.failure || result.assertionFailure || null,
          score: result.score ?? (passed ? 1 : 0),
          latencyMs: result.latencyMs ?? null,
          cost: result.cost ?? null,
        });

        if (errored) {
          errorCount++;
          allErrors.push({ file: groupName, test: result.name || result.id, error: result.error });
        } else if (failed) {
          failCount++;
          allFailures.push({ file: groupName, test: result.name || result.id, failure: result.failure });
        } else {
          passCount++;
        }
      }
    } else if (Array.isArray(data)) {
      for (const entry of data) {
        const passed = !!entry.passed;
        allResults.push({
          group: groupName,
          testName: entry.name || entry.id || 'unnamed',
          passed,
          error: entry.error || null,
          failure: null,
          score: entry.score ?? (passed ? 1 : 0),
          latencyMs: entry.latencyMs ?? null,
          cost: entry.cost ?? null,
        });
        if (passed) passCount++;
        else failCount++;
      }
    } else {
      allErrors.push({ file: groupName, test: 'unknown', error: 'Unexpected result format' });
      errorCount++;
    }
  }

  const total = passCount + failCount + errorCount;
  const aggregated = {
    summary: {
      total,
      passed: passCount,
      failed: failCount,
      errored: errorCount,
      passRate: total > 0 ? passCount / total : 0,
    },
    results: allResults,
    errors: allErrors,
    failures: allFailures,
    timestamp: new Date().toISOString(),
  };

  writeFileSync(AGGREGATED_PATH, JSON.stringify(aggregated, null, 2), 'utf-8');
  console.log(`Aggregated ${total} results: ${passCount} passed, ${failCount} failed, ${errorCount} errored`);
  console.log(`Pass rate: ${(aggregated.summary.passRate * 100).toFixed(1)}%`);
  console.log(`Output: ${AGGREGATED_PATH}`);

  return aggregated;
}

const result = aggregate();
process.exit(result.summary.errored > 0 ? 2 : 0);
