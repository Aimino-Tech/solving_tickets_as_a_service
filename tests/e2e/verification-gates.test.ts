/**
 * AIM-3210: Verification Gates E2E Smoke Test
 *
 * Validates all verification gates required for launch:
 *   - TypeScript compiles check
 *   - All unit/integration tests pass check
 *   - Quality gates pass check
 *   - E2E smoke test runner
 *   - MCP server responds check
 *   - Health endpoints check
 *   - Security scan check
 *
 * This test file verifies that the verification infrastructure exists
 * and is configured correctly. It does not run the actual gates
 * (those are CI-level concerns) — it validates the configuration.
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '../..');

describe('Verification Gates: Infrastructure Configuration', () => {
  describe('Gate 1: TypeScript Compiles Check', () => {
    it('tsconfig.json exists and is valid', () => {
      const tsconfigPath = path.join(PROJECT_ROOT, 'tsconfig.json');
      expect(fs.existsSync(tsconfigPath)).toBe(true);

      const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf-8'));
      expect(tsconfig).toHaveProperty('compilerOptions');
    });

    it('TypeScript check npm script exists', () => {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf-8'),
      );
      expect(pkg.scripts).toHaveProperty('typecheck');
      expect(pkg.scripts.typecheck).toContain('tsc');
    });
  });

  describe('Gate 2: Unit/Integration Tests Pass Check', () => {
    it('Test npm script exists', () => {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf-8'),
      );
      expect(pkg.scripts).toHaveProperty('test');
      expect(pkg.scripts).toHaveProperty('test:coverage');
    });

    it('Vitest configuration exists', () => {
      const vitestConfigs = [
        'vitest.config.ts',
        'vitest.e2e.config.ts',
        'vitest.integration.config.ts',
      ];
      for (const config of vitestConfigs) {
        expect(fs.existsSync(path.join(PROJECT_ROOT, config))).toBe(true);
      }
    });

    it('Test files exist in src/__tests__/', () => {
      const testDir = path.join(PROJECT_ROOT, 'src/__tests__');
      expect(fs.existsSync(testDir)).toBe(true);
      const files = fs.readdirSync(testDir);
      expect(files.length).toBeGreaterThan(0);
    });
  });

  describe('Gate 3: Quality Gates Pass Check', () => {
    it('Quality gates script exists', () => {
      const scriptPath = path.join(PROJECT_ROOT, 'scripts/quality-gates.sh');
      expect(fs.existsSync(scriptPath)).toBe(true);
    });

    it('Quality gates npm script exists', () => {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf-8'),
      );
      expect(pkg.scripts).toHaveProperty('quality-gates');
    });

    it('Biome configuration exists (for linting)', () => {
      expect(fs.existsSync(path.join(PROJECT_ROOT, 'biome.json'))).toBe(true);
    });

    it('ESLint configuration exists', () => {
      expect(fs.existsSync(path.join(PROJECT_ROOT, 'eslint.config.mjs'))).toBe(true);
    });
  });

  describe('Gate 4: E2E Smoke Test Runner', () => {
    it('E2E test directory exists', () => {
      const e2eDir = path.join(PROJECT_ROOT, 'tests/e2e');
      expect(fs.existsSync(e2eDir)).toBe(true);
    });

    it('E2E test files exist', () => {
      const e2eDir = path.join(PROJECT_ROOT, 'tests/e2e');
      const files = fs.readdirSync(e2eDir);
      const testFiles = files.filter((f) => f.endsWith('.test.ts'));
      expect(testFiles.length).toBeGreaterThan(0);
    });

    it('E2E vitest config exists', () => {
      expect(fs.existsSync(path.join(PROJECT_ROOT, 'vitest.e2e.config.ts'))).toBe(true);
    });

    it('E2E test harness exists', () => {
      const harnessDir = path.join(PROJECT_ROOT, 'tests/e2e/harness');
      expect(fs.existsSync(harnessDir)).toBe(true);
      const files = fs.readdirSync(harnessDir);
      expect(files).toContain('index.ts');
      expect(files).toContain('env.ts');
    });
  });

  describe('Gate 5: MCP Server Responds Check', () => {
    it('MCP server source files exist', () => {
      const mcpFile = path.join(PROJECT_ROOT, 'src/mcp.ts');
      expect(fs.existsSync(mcpFile)).toBe(true);
    });

    it('MCP routes exist', () => {
      const mcpRoutesDir = path.join(PROJECT_ROOT, 'src/routes/mcp.ts');
      expect(fs.existsSync(mcpRoutesDir)).toBe(true);
    });
  });

  describe('Gate 6: Health Endpoints Check', () => {
    it('Health module exists', () => {
      const healthDir = path.join(PROJECT_ROOT, 'src/health');
      expect(fs.existsSync(healthDir)).toBe(true);
      const files = fs.readdirSync(healthDir);
      expect(files).toContain('index.ts');
    });

    it('Health dependencies check exists', () => {
      expect(fs.existsSync(path.join(PROJECT_ROOT, 'src/health/dependencies.ts'))).toBe(true);
    });

    it('Queue health monitoring exists', () => {
      expect(fs.existsSync(path.join(PROJECT_ROOT, 'src/health/queueHealth.ts'))).toBe(true);
    });

    it('Redis health check exists', () => {
      expect(fs.existsSync(path.join(PROJECT_ROOT, 'src/health/redisHealth.ts'))).toBe(true);
    });

    it('OpenCode health check exists', () => {
      expect(fs.existsSync(path.join(PROJECT_ROOT, 'src/health/opencodeHealth.ts'))).toBe(true);
    });
  });

  describe('Gate 7: Security Scan Check', () => {
    it('Security audit npm script exists', () => {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf-8'),
      );
      expect(pkg.scripts).toHaveProperty('audit');
    });

    it('SAST workflow exists', () => {
      expect(
        fs.existsSync(path.join(PROJECT_ROOT, '.github/workflows/sast.yml')),
      ).toBe(true);
    });

    it('Secret scan workflow exists', () => {
      expect(
        fs.existsSync(path.join(PROJECT_ROOT, '.github/workflows/secret-scan.yml')),
      ).toBe(true);
    });

    it('Container scan workflow exists', () => {
      expect(
        fs.existsSync(path.join(PROJECT_ROOT, '.github/workflows/container-scan.yml')),
      ).toBe(true);
    });

    it('IP allowlist middleware exists', () => {
      expect(
        fs.existsSync(path.join(PROJECT_ROOT, 'src/security/ipAllowlist.js')),
      ).toBe(true);
    });

    it('Admin auth middleware exists', () => {
      expect(
        fs.existsSync(path.join(PROJECT_ROOT, 'src/security/adminAuth.js')),
      ).toBe(true);
    });
  });

  describe('Gate 8: CI Workflow Configuration', () => {
    it('Main CI workflow exists', () => {
      expect(
        fs.existsSync(path.join(PROJECT_ROOT, '.github/workflows/ci.yml')),
      ).toBe(true);
    });

    it('E2E verify workflow exists', () => {
      expect(
        fs.existsSync(path.join(PROJECT_ROOT, '.github/workflows/e2e-verify.yml')),
      ).toBe(true);
    });

    it('CD workflow exists', () => {
      expect(
        fs.existsSync(path.join(PROJECT_ROOT, '.github/workflows/cd.yml')),
      ).toBe(true);
    });

    it('Docker Compose files exist', () => {
      const composeFiles = [
        'docker-compose.yml',
        'docker-compose.dev.yml',
        'docker-compose.e2e.yml',
        'docker-compose.prod.yml',
      ];
      for (const file of composeFiles) {
        expect(fs.existsSync(path.join(PROJECT_ROOT, file))).toBe(true);
      }
    });
  });
});
