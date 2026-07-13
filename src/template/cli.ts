#!/usr/bin/env tsx
/**
 * stas CLI — Template validation and dry-run tool.
 *
 * Commands:
 *   stas template validate              Validate all templates in .stas/templates/
 *   stas template validate --file x.yaml  Validate a single template file
 *   stas template validate --format json  Output as JSON (default: tty)
 *   stas template dry-run --input payload.json  Dry-run with placeholder data
 *   stas install-hook                   Install git pre-commit hook for templates
 *
 * Exit codes: 0 = valid, 1 = validation errors, 2 = other errors
 */

import { readFileSync, existsSync, readdirSync, writeFileSync, chmodSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import * as yaml from "js-yaml";
import { validateTemplateYaml, dryRunResolve, preflightValidate } from "./validator.js";
import type { ValidationResult, ValidationError, TemplateYaml } from "./validator.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ValidateOptions {
  file?: string;
  dir?: string;
  format?: "tty" | "json";
}

export interface DryRunOptions {
  file?: string;
  input?: string;
  dir?: string;
  format?: "tty" | "json";
}

export interface FileResult {
  file: string;
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
  resolved?: Array<{ phase: string; command: string; resolved: string }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);

const STYLES = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
} as const;

function style(code: string, text: string): string {
  // In tests, skip ANSI codes
  if (process.env.NODE_ENV === "test" || process.env.VITEST) return text;
  return `${code}${text}${STYLES.reset}`;
}

function printValidationResult(result: FileResult, format: "tty" | "json"): void {
  if (format === "json") {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const status = result.valid
    ? style(STYLES.green, "✓ VALID")
    : style(STYLES.red, "✗ INVALID");
  console.log(`\n${style(STYLES.bold, result.file)} — ${status}`);

  if (result.errors.length > 0) {
    console.log(`  ${style(STYLES.red, "Errors:")}`);
    for (const err of result.errors) {
      const loc = err.field ? ` [${err.field}]` : "";
      console.log(`    • ${err.message}${style(STYLES.dim, loc)}`);
    }
  }

  if (result.warnings.length > 0) {
    console.log(`  ${style(STYLES.yellow, "Warnings:")}`);
    for (const warn of result.warnings) {
      const loc = warn.field ? ` [${warn.field}]` : "";
      console.log(`    • ${warn.message}${style(STYLES.dim, loc)}`);
    }
  }

  if (result.resolved && result.resolved.length > 0) {
    console.log(`  ${style(STYLES.cyan, "Resolved commands:")}`);
    let currentPhase = "";
    for (const r of result.resolved) {
      if (r.phase !== currentPhase) {
        currentPhase = r.phase;
        console.log(`    ${style(STYLES.bold, `[${r.phase}]`)}`);
      }
      console.log(`      ${style(STYLES.dim, "template:")} ${r.command}`);
      console.log(`      ${style(STYLES.green, "resolved:")} ${r.resolved}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Template loading / scanning helpers
// ---------------------------------------------------------------------------

function collectTemplateFiles(templateDir: string, singleFile?: string): string[] {
  const dir = resolve(templateDir);

  if (singleFile) {
    const filePath = resolve(singleFile);
    if (!existsSync(filePath)) {
      throw new Error(`Template file not found: ${filePath}`);
    }
    return [filePath];
  }

  if (!existsSync(dir)) {
    throw new Error(`Template directory not found: ${dir}`);
  }

  const entries = readdirSync(dir);
  const files = entries
    .filter((e) => e.endsWith(".yaml") || e.endsWith(".yml"))
    .map((e) => join(dir, e));

  if (files.length === 0) {
    throw new Error(`No .yaml/.yml files found in ${dir}`);
  }

  return files;
}

function loadAndValidateFile(filePath: string): FileResult {
  const fileName = resolve(filePath);
  const raw = readFileSync(fileName, "utf-8");
  const parsed = yaml.load(raw);

  const validation: ValidationResult = validateTemplateYaml(parsed, fileName);

  return {
    file: fileName,
    valid: validation.valid,
    errors: validation.errors,
    warnings: validation.warnings,
  };
}

// ---------------------------------------------------------------------------
// validateAction
// ---------------------------------------------------------------------------

export function validateAction(
  templateDir: string,
  options: ValidateOptions = {},
): FileResult[] {
  const format = options.format ?? "tty";
  const files = collectTemplateFiles(templateDir, options.file);
  const results: FileResult[] = [];

  for (const file of files) {
    const result = loadAndValidateFile(file);
    results.push(result);
  }

  // Summary
  const total = results.length;
  const validCount = results.filter((r) => r.valid).length;
  const errorCount = results.reduce((s, r) => s + r.errors.length, 0);
  const warningCount = results.reduce((s, r) => s + r.warnings.length, 0);

  if (format === "tty") {
    for (const result of results) {
      printValidationResult(result, format);
    }

    console.log(
      `\n${style(STYLES.bold, "Summary:")} ${validCount}/${total} valid` +
        `  |  ${style(STYLES.red, `${errorCount} errors`)}` +
        `  |  ${style(STYLES.yellow, `${warningCount} warnings`)}`,
    );
  } else {
    // JSON: output once at the end
    console.log(JSON.stringify({ results, summary: { total, validCount, errorCount, warningCount } }, null, 2));
  }

  return results;
}

// ---------------------------------------------------------------------------
// dryRunAction
// ---------------------------------------------------------------------------

export function dryRunAction(
  templateDir: string,
  inputPayload: Record<string, string | number>,
  options: DryRunOptions = {},
): FileResult[] {
  const format = options.format ?? "tty";
  const files = collectTemplateFiles(templateDir, options.file);
  const results: FileResult[] = [];

  for (const file of files) {
    const raw = readFileSync(file, "utf-8");
    const parsed = yaml.load(raw);

    const validation = validateTemplateYaml(parsed);

    // Only attempt resolution if basic YAML structure is valid
    let resolved: Array<{ phase: string; command: string; resolved: string }> = [];
    let preflight: ValidationResult = { valid: true, errors: [], warnings: [] };

    if (validation.valid || validation.errors.every((e) => e.type !== "schema")) {
      try {
        const template = parsed as TemplateYaml;
        resolved = dryRunResolve(template, inputPayload);
        const resolvedCmds = resolved.map((r) => r.resolved);
        preflight = preflightValidate(resolvedCmds);
      } catch {
        // If resolution fails due to malformed structure, skip resolution
        preflight = {
          valid: false,
          errors: [{ type: "dry_run", message: "Could not resolve commands due to template structure errors" }],
          warnings: [],
        };
      }
    }

    results.push({
      file: resolve(file),
      valid: validation.valid && preflight.valid,
      errors: [...validation.errors, ...preflight.errors],
      warnings: [...validation.warnings, ...preflight.warnings],
      resolved,
    });
  }

  if (format === "tty") {
    for (const result of results) {
      printValidationResult(result, format);
    }
  } else {
    console.log(JSON.stringify({ results }, null, 2));
  }

  return results;
}

// ---------------------------------------------------------------------------
// installHook
// ---------------------------------------------------------------------------

export function installHook(): void {
  const repoRoot = resolve(process.cwd());
  const gitDir = join(repoRoot, ".git");
  const hooksDir = join(gitDir, "hooks");

  if (!existsSync(gitDir)) {
    console.error(style(STYLES.red, "Error: Not a git repository (no .git directory)"));
    process.exit(2);
  }

  if (!existsSync(hooksDir)) {
    // Create hooks dir if it doesn't exist
    execSync("git rev-parse --git-dir", { cwd: repoRoot });
  }

  const hookContent = `#!/bin/sh
# STAS template pre-commit hook
# Validates .stas/templates/*.yaml files before commit
# Installed by: stas install-hook

set -e

CHANGED_TEMPLATES=$(git diff --cached --name-only --diff-filter=ACM | grep -E '^\\.stas/templates/.+\\.(yaml|yml)$' || true)

if [ -z "$CHANGED_TEMPLATES" ]; then
  exit 0
fi

echo "STAS: Validating changed template files..."

HAS_ERRORS=0
for file in $CHANGED_TEMPLATES; do
  if [ -f "$file" ]; then
    if ! npx tsx "$(dirname "$0")/../../src/template/cli.ts" template validate --file "$file" --format json > /dev/null 2>&1; then
      echo "STAS: ✗ Validation failed for $file"
      npx tsx "$(dirname "$0")/../../src/template/cli.ts" template validate --file "$file"
      HAS_ERRORS=1
    else
      echo "STAS: ✓ $file is valid"
    fi
  fi
done

if [ "$HAS_ERRORS" -ne 0 ]; then
  echo "STAS: Template validation failed. Commit blocked."
  exit 1
fi

echo "STAS: All templates valid."
`;

  const hookPath = join(hooksDir, "pre-commit");
  writeFileSync(hookPath, hookContent, "utf-8");
  chmodSync(hookPath, 0o755);

  console.log(style(STYLES.green, `✓ Pre-commit hook installed at ${hookPath}`));
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

function printHelp(): void {
  const b = (s: string) => style(STYLES.bold, s);
  const d = (s: string) => style(STYLES.dim, s);
  console.log(`
${b("stas")} — Template validation and dry-run tool

${b("USAGE")}
  stas template validate [options]
  stas template dry-run [options]
  stas install-hook

${b("COMMANDS")}
  ${b("template validate")}     Validate template YAML files
    ${d("--file <path>")}       Validate a single file
    ${d("--dir <path>")}        Template directory (default: .stas/templates/)
    ${d("--format <type>")}     Output format: tty (default) | json

  ${b("template dry-run")}      Resolve placeholders and show commands
    ${d("--input <path>")}      JSON payload file (use "-" for stdin)
    ${d("--dir <path>")}        Template directory (default: .stas/templates/)
    ${d("--format <type>")}     Output format: tty (default) | json

  ${b("install-hook")}          Install git pre-commit hook for template validation

${b("EXIT CODES")}
  0   All templates valid
  1   Validation errors found
  2   Runtime error (file not found, parse error, etc.)
`);
}

function parseArgs(): void {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    printHelp();
    process.exit(0);
  }

  try {
    const command = args[0];

    if (command === "install-hook") {
      installHook();
      return;
    }

    if (command !== "template") {
      console.error(`Unknown command: ${command}`);
      console.error("Run 'stas --help' for usage.");
      process.exit(2);
    }

    const subcommand = args[1];

    if (!subcommand || (subcommand !== "validate" && subcommand !== "dry-run")) {
      console.error(`Unknown subcommand: ${subcommand}`);
      console.error("Run 'stas --help' for usage.");
      process.exit(2);
    }

    // Parse flags
    const options: Record<string, string> = {};
    for (let i = 2; i < args.length; i++) {
      const arg = args[i];
      if (arg.startsWith("--")) {
        const key = arg.slice(2);
        const val = args[i + 1];
        if (val && !val.startsWith("--")) {
          options[key] = val;
          i++;
        } else {
          options[key] = "true";
        }
      }
    }

    const templateDir = options.dir ?? ".stas/templates";
    const format = (options.format as "tty" | "json") ?? "tty";

    if (subcommand === "validate") {
      const results = validateAction(templateDir, {
        file: options.file,
        dir: options.dir,
        format,
      });

      const allValid = results.every((r) => r.valid);
      process.exit(allValid ? 0 : 1);
    }

    if (subcommand === "dry-run") {
      let payload: Record<string, string | number> = {};

      if (options.input) {
        const inputPath = options.input === "-" ? "/dev/stdin" : options.input;
        const raw = readFileSync(inputPath, "utf-8");
        payload = JSON.parse(raw);
      }

      const results = dryRunAction(templateDir, payload, {
        file: options.file,
        dir: options.dir,
        format,
      });

      const allValid = results.every((r) => r.valid);
      process.exit(allValid ? 0 : 1);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(style(STYLES.red, `Error: ${message}`));
    process.exit(2);
  }
}

// Only run when called directly (not imported in tests)
const isMain =
  process.argv[1] &&
  (process.argv[1] === __filename ||
    process.argv[1].endsWith("/cli.ts") ||
    process.argv[1].endsWith("\\cli.ts") ||
    process.argv[1] === resolve(__filename));

if (isMain) {
  parseArgs();
}
