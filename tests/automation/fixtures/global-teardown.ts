import type { FullConfig } from '@playwright/test';

async function globalTeardown(_config: FullConfig): Promise<void> {
  console.log('\n[TEARDOWN] Automation test run complete.\n');

  const testResultsPath = './tests/automation/reports/test-results.json';
  try {
    const results = await import('node:fs').then((fs) =>
      JSON.parse(fs.readFileSync(testResultsPath, 'utf-8')),
    );
    console.log(`[TEARDOWN] Test results saved to ${testResultsPath}`);
  } catch {
    console.log('[TEARDOWN] No test results file found.');
  }
}

export default globalTeardown;
