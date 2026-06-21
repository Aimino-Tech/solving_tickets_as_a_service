import vitest from '@vitest/eslint-plugin';
import noMockCoreInfra from './eslint-rules/no-mock-core-infra.js';
import tsParser from '@typescript-eslint/parser';

export default [
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/plugin/**'],
  },
  {
    files: ['**/__tests__/**', '*.test.ts', '*.spec.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: new URL('.', import.meta.url).pathname,
      },
    },
    plugins: {
      vitest,
      custom: {
        rules: {
          'no-mock-core-infra': noMockCoreInfra,
        },
      },
    },
    rules: {
      'custom/no-mock-core-infra': ['error', {
        forbiddenPatterns: ['SandboxExecutor', 'qualityGates', 'ActionDispatcher'],
      }],
      'vitest/no-standalone-expect': 'error',
      'vitest/valid-expect': 'error',
      'vitest/prefer-to-be': 'error',
      'vitest/no-conditional-expect': 'error',
      'vitest/no-conditional-in-test': 'error',
    },
  },
  {
    files: [
      '**/__tests__/sandbox/executor.test.ts',
      '**/__tests__/agent/qualityGates.test.ts',
      '**/__tests__/agent/hallucinationGates.test.ts',
      '**/__tests__/agent/syntheticDataCheck.test.ts',
      '**/__tests__/agent/issueGrounding.test.ts',
    ],
    rules: {
      'custom/no-mock-core-infra': 'off',
    },
  },
];
