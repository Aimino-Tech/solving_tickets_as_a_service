import * as core from '@actions/core';
import * as github from '@actions/github';
import { StasApiClient } from './api-client.js';

const VALID_SUITES = ['smoke', 'standard', 'full'] as const;
type EvalSuite = (typeof VALID_SUITES)[number];

function validateSuite(value: string): EvalSuite {
  const lower = value.toLowerCase();
  if (!(VALID_SUITES as readonly string[]).includes(lower)) {
    throw new Error(
      `Invalid eval-suite: "${value}". Must be one of: ${VALID_SUITES.join(', ')}`,
    );
  }
  return lower as EvalSuite;
}

export async function run(): Promise<void> {
  try {
    const apiKey = core.getInput('api-key', { required: true });
    const evalSuite = validateSuite(core.getInput('eval-suite') || 'smoke');
    const langfusePublicKey = core.getInput('langfuse-public-key');
    const langfuseSecretKey = core.getInput('langfuse-secret-key');
    const stasApiUrl = core.getInput('stas-api-url') || 'https://api.stas.aimino.io';

    core.info(`STAS Eval Pipeline — suite: ${evalSuite}`);
    core.info(`API URL: ${stasApiUrl}`);

    const client = new StasApiClient(stasApiUrl, apiKey);

    core.info('Triggering eval run...');
    const { id } = await client.triggerEval({
      suite: evalSuite,
      langfusePublicKey: langfusePublicKey || undefined,
      langfuseSecretKey: langfuseSecretKey || undefined,
    });

    core.info(`Eval run started — ID: ${id}`);
    core.info('Polling for completion...');

    const result = await client.pollEvalStatus(id);

    core.setOutput('pass-rate', result.passRate?.toString() ?? '');
    core.setOutput('pass-rate-delta', result.passRateDelta?.toString() ?? '');
    core.setOutput('langfuse-trace-url', result.langfuseTraceUrl ?? '');
    core.setOutput('regression-detected', result.regressionDetected?.toString() ?? '');
    core.setOutput('status', result.status);

    const trendArrow = result.passRateDelta !== undefined
      ? (result.passRateDelta > 0 ? '↑' : result.passRateDelta < 0 ? '↓' : '→')
      : '→';

    const annotationBody = [
      `**STAS Eval — ${evalSuite}**`,
      `Pass Rate: **${result.passRate?.toFixed(1) ?? 'N/A'}%** ${trendArrow}`,
      result.regressionDetected ? '⚠️ **Regression detected!**' : '',
      result.langfuseTraceUrl ? `🔗 [LangFuse Trace](${result.langfuseTraceUrl})` : '',
    ].filter(Boolean).join('\n\n');

    if (github.context.payload.pull_request) {
      (core as any).notice(annotationBody);
    }

    if (result.status === 'failed') {
      core.setFailed(`Eval run failed: ${result.error ?? 'Unknown error'}`);
      return;
    }

    if (result.regressionDetected) {
      core.warning('Regression detected — pass rate decreased from baseline');
    }

    core.info(`Eval completed. Pass rate: ${result.passRate?.toFixed(1) ?? 'N/A'}%`);
    if (result.langfuseTraceUrl) {
      core.info(`LangFuse Trace: ${result.langfuseTraceUrl}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.setOutput('status', 'error');
    core.setFailed(`STAS Eval action failed: ${message}`);
  }
}

if (require.main === module) {
  run();
}
