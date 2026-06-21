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
      'no-restricted-imports': ['error', {
        paths: [
          { name: 'sandbox/executor', message: 'DO NOT import sandbox/executor directly in tests — use real sandbox tests instead' },
          { name: './sandbox/executor', message: 'DO NOT import sandbox/executor directly in tests — use real sandbox tests instead' },
          { name: '../sandbox/executor', message: 'DO NOT import sandbox/executor directly in tests — use real sandbox tests instead' },
          { name: '../../sandbox/executor', message: 'DO NOT import sandbox/executor directly in tests — use real sandbox tests instead' },
          { name: 'agent/qualityGates', message: 'Quality gates must be tested with real execution, not mocks' },
          { name: './qualityGates', message: 'Quality gates must be tested with real execution, not mocks' },
          { name: '../qualityGates', message: 'Quality gates must be tested with real execution, not mocks' },
          { name: '../../qualityGates', message: 'Quality gates must be tested with real execution, not mocks' },
        ],
      }],
      'custom/no-mock-core-infra': ['error', {
        forbiddenPatterns: ['sandbox/executor', 'qualityGates', 'actionDispatcher'],
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
      'no-restricted-imports': 'off',
    },
  },
];
