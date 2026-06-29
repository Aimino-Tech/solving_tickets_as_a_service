import type { StepContext, ResolvedCommand } from './types.js';

const PLACEHOLDER_RE = /\{(\w+(?:\.\w+)*)\}/g;

function resolvePlaceholder(match: string, path: string, context: StepContext): string {
  const parts = path.split('.');
  let value: unknown = context;

  for (const part of parts) {
    if (value === null || value === undefined) return match;
    if (typeof value === 'object' && value !== null && part in value) {
      value = (value as Record<string, unknown>)[part];
    } else {
      return match;
    }
  }

  if (Array.isArray(value)) {
    return value.join(',');
  }

  return String(value ?? match);
}

export function replacePlaceholders(command: string, context: StepContext): string {
  return command.replace(PLACEHOLDER_RE, (match, path) => resolvePlaceholder(match, path, context));
}

export function extractPlaceholders(command: string): string[] {
  const placeholders: string[] = [];
  let match: RegExpExecArray | null;
  const regex = new RegExp(PLACEHOLDER_RE.source, 'g');
  while ((match = regex.exec(command)) !== null) {
    placeholders.push(match[1]);
  }
  return [...new Set(placeholders)];
}

export function resolveCommand(command: string, context: StepContext): ResolvedCommand {
  const placeholders = extractPlaceholders(command);
  const resolved = replacePlaceholders(command, context);
  return { command: resolved, placeholders };
}
