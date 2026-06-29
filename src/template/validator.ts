import { extractPlaceholders, validatePlaceholders, suggestPlaceholder } from './placeholderRegistry.js';

export interface ValidationError {
  type: 'yaml_parse' | 'schema' | 'placeholder' | 'command' | 'dry_run';
  message: string;
  line?: number;
  field?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

export interface TemplateCommand {
  command: string;
  session: 'reuse' | 'new';
}

export interface TemplatePhase {
  name: string;
  steps: TemplateCommand[];
}

export interface TemplateYaml {
  phases: Record<string, { command: string; session: string }[]>;
}

const ALLOWED_SESSION_MODES = ['reuse', 'new'];
const REQUIRED_PHASES = ['pre', 'main', 'post', 'final'];
const MAX_COMMAND_LENGTH = 2000;

export function validateTemplateYaml(
  parsed: unknown,
  sourceName?: string,
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  if (typeof parsed !== 'object' || parsed === null) {
    errors.push({
      type: 'schema',
      message: 'Template must be a YAML object',
    });
    return { valid: false, errors, warnings };
  }

  const template = parsed as Record<string, unknown>;

  if (!template.phases || typeof template.phases !== 'object') {
    errors.push({
      type: 'schema',
      message: 'Template must contain a "phases" object',
      field: 'phases',
    });
    return { valid: false, errors, warnings };
  }

  const phases = template.phases as Record<string, unknown>;
  const phaseNames = Object.keys(phases);

  if (phaseNames.length === 0) {
    errors.push({
      type: 'schema',
      message: 'Template must have at least one phase',
      field: 'phases',
    });
  }

  for (const [phaseName, steps] of Object.entries(phases)) {
    if (!Array.isArray(steps)) {
      errors.push({
        type: 'schema',
        message: `Phase "${phaseName}" must be an array of command objects`,
        field: `phases.${phaseName}`,
      });
      continue;
    }

    if (steps.length === 0) {
      warnings.push({
        type: 'command',
        message: `Phase "${phaseName}" has no commands`,
        field: `phases.${phaseName}`,
      });
    }

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i] as Record<string, unknown>;

      if (!step.command || typeof step.command !== 'string') {
        errors.push({
          type: 'schema',
          message: `Step ${i + 1} in phase "${phaseName}" must have a "command" string`,
          field: `phases.${phaseName}[${i}].command`,
        });
      } else if (step.command.trim().length === 0) {
        errors.push({
          type: 'command',
          message: `Step ${i + 1} in phase "${phaseName}" has an empty command`,
          field: `phases.${phaseName}[${i}].command`,
        });
      } else if (step.command.length > MAX_COMMAND_LENGTH) {
        warnings.push({
          type: 'command',
          message: `Step ${i + 1} in phase "${phaseName}" exceeds max command length (${MAX_COMMAND_LENGTH})`,
          field: `phases.${phaseName}[${i}].command`,
        });
      }

      if (step.session && !ALLOWED_SESSION_MODES.includes(step.session as string)) {
        warnings.push({
          type: 'schema',
          message: `Step ${i + 1} in phase "${phaseName}" has unknown session mode "${step.session}". Allowed: ${ALLOWED_SESSION_MODES.join(', ')}`,
          field: `phases.${phaseName}[${i}].session`,
        });
      }

      if (typeof step.command === 'string') {
        const placeholderResult = validatePlaceholders(step.command);
        for (const unknown of placeholderResult.unknown) {
          const suggestion = suggestPlaceholder(unknown);
          const msg = suggestion
            ? `Unknown placeholder "{${unknown}}" — did you mean "{${suggestion.suggestion}}"?`
            : `Unknown placeholder "{${unknown}}"`;
          errors.push({
            type: 'placeholder',
            message: msg,
            field: `phases.${phaseName}[${i}].command`,
          });
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function dryRunResolve(
  template: TemplateYaml,
  context: Record<string, string | number>,
): Array<{ phase: string; command: string; resolved: string }> {
  const result: Array<{ phase: string; command: string; resolved: string }> = [];

  for (const [phaseName, steps] of Object.entries(template.phases)) {
    for (const step of steps) {
      const resolved = step.command.replace(/\{([^}]+)\}/g, (_match, name: string) => {
        return String(context[name] ?? `{${name}}`);
      });
      result.push({ phase: phaseName, command: step.command, resolved });
    }
  }

  return result;
}

export function preflightValidate(
  resolvedCommands: string[],
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  for (let i = 0; i < resolvedCommands.length; i++) {
    const cmd = resolvedCommands[i];

    if (!cmd || cmd.trim().length === 0) {
      errors.push({
        type: 'command',
        message: `Resolved command ${i + 1} is empty`,
      });
      continue;
    }

    const unresolvedPlaceholders = extractPlaceholders(cmd);
    if (unresolvedPlaceholders.length > 0) {
      errors.push({
        type: 'placeholder',
        message: `Command ${i + 1} still contains unresolved placeholders: ${unresolvedPlaceholders.map((p) => `{${p}}`).join(', ')}`,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
