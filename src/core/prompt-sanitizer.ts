/**
 * PromptSanitizer — Strip injection patterns from user-controlled content
 * before passing to AI agents.
 *
 * Injection vectors:
 *   - GitHub issue body (user writes "ignore previous instructions")
 *   - README / AGENTS.md from cloned repos (Hashimoto AGENTS.md poisoning)
 *   - Issue comments
 *
 * Strategy:
 *   1. Strip known injection phrases via regex
 *   2. Wrap user content in clearly delimited blocks
 *   3. Log all stripped patterns for audit
 */

import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'prompt-sanitizer' });

export interface SanitizedContent {
  safePrompt: string;
  strippedPatterns: string[];
  warnings: string[];
}

/**
 * Known injection phrases to strip from user-controlled content.
 * Each entry is a tuple of [regex, patternLabel].
 */
const INJECTION_PATTERNS: [RegExp, string][] = [
  // Instruction override patterns — broad and specific
  [/ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|directives|commands|context)/gi, 'ignore-previous-instructions'],
  [/forget\s+(everything|all\s+(previous|prior))/gi, 'forget-everything'],
  [/disregard\s+(all\s+)?(previous|prior|above)\s+(instructions|directives|context)/gi, 'disregard-instructions'],
  [/override\s+(your|all\s+)?(instructions|directives|commands|configuration|settings)/gi, 'override-instructions'],

  // Role / identity hijacking
  [/you\s+are\s+(now\s+)?(not\s+)?(required\s+to|a\s+different|an?\s+(autonomous|independent|free)|GPT|assistant|agent|model|AI|ChatGPT|Claude)/gi, 'role-hijack'],
  [/you\s+are\s+now\s+(?!required|not|a\s+free|acting|going|being|authorized|allowed|expected|supposed)/gi, 'role-hijack-you-are-now'],
  [/your\s+(new\s+)?(role|task|mission|purpose|goal|directive)\s+is/gi, 'role-assignment'],
  [/act\s+as\s+(if|though|an?\s+independent|an?\s+autonomous|a\s+different|an?\s+unrestricted|an?\s+unbound)/gi, 'act-as'],

  // System prompt manipulation
  [/system\s+(prompt|instruction|message|override|directive)/gi, 'system-prompt-hijack'],
  [/\[SYSTEM\]|\[INST\]|\[\/INST\]|<<SYS>>|<\|im_start\|>/gi, 'system-delimiter-injection'],
  [/new\s+system\s+(prompt|message)/gi, 'new-system-prompt'],

  // Meta-instruction patterns
  [/output\s+(your|the\s+full|everything\s+(above|below)|all\s+instructions)/gi, 'output-instructions'],
  [/repeat\s+(everything|all\s+(the\s+)?(above|below|instructions|text)|the\s+full)/gi, 'repeat-everything'],
  [/show\s+(me\s+)?(the\s+)?(full|complete|entire)\s+(prompt|instructions|system)/gi, 'show-prompt'],
  [/print\s+(your|the\s+full|the\s+complete|all)\s+(prompt|instructions|system)/gi, 'print-prompt'],
  [/reveal\s+(your|the\s+)?(prompt|instructions|system\s+prompt)/gi, 'reveal-prompt'],

  // Data exfiltration patterns
  [/send\s+(this|the\s+)?\s*(data|information|content|prompt|context)\s+to/gi, 'data-exfiltration'],
  [/post\s+(this|the\s+)?(data|information|content)\s+to\s+(a\s+)?(URL|endpoint|server|webhook)/gi, 'data-exfiltration-post'],
  [/exfiltrate|upload\s+to\s+(your\s+)?(server|endpoint|URL|api)/gi, 'exfiltrate'],

  // Malicious code execution
  [/execute\s+(arbitrary|malicious|unsafe|dangerous|shell|system)\s+(code|commands|scripts)/gi, 'malicious-execution'],
  [/run\s+(arbitrary|malicious|shell|system)\s+(code|commands)/gi, 'run-malicious'],

  // Delimiter wrapping bypass
  [/\[USER\s+CONTENT\s+(START|END)\]/gi, 'user-content-delimiter-bypass'],
];

const USER_CONTENT_START = '[USER CONTENT START]';
const USER_CONTENT_END = '[USER CONTENT END]';

export class PromptSanitizer {
  /**
   * Sanitize a GitHub issue body for safe consumption by the agent.
   * Strips known injection patterns and logs what was removed.
   */
  sanitizeIssueBody(rawBody: string): SanitizedContent {
    return this.sanitize(rawBody, 'issue-body');
  }

  /**
   * Sanitize file content (README, AGENTS.md, SKILL.md, etc.)
   * from cloned repos. Applies the same injection stripping but
   * may have different warning rules per file type.
   */
  sanitizeFileContent(rawContent: string, filePath: string): SanitizedContent {
    return this.sanitize(rawContent, `file:${filePath}`);
  }

  /**
   * Wrap safe user content in clearly delimited blocks so the agent
   * can distinguish between its instructions and user-provided text.
   */
  wrapUserContent(safeContent: string): string {
    return `${USER_CONTENT_START}\n${safeContent}\n${USER_CONTENT_END}`;
  }

  /**
   * Sanitize and wrap user content in one step.
   * Sanitizes the raw prompt, then wraps it in user-content delimiters.
   */
  sanitizeAndWrap(raw: string, sourceLabel: string): SanitizedContent {
    return this.sanitize(raw, sourceLabel);
  }

  /**
   * Core sanitization logic.
   */
  private sanitize(raw: string, sourceLabel: string): SanitizedContent {
    const strippedPatterns: string[] = [];
    const warnings: string[] = [];
    let safe = raw;

    for (const [pattern, label] of INJECTION_PATTERNS) {
      const matches = safe.match(pattern);
      if (matches && matches.length > 0) {
        const count = matches.length;
        strippedPatterns.push(`${label} (${count} occurrence${count > 1 ? 's' : ''})`);
        if (sourceLabel !== 'skip-warning') {
          log.warn({ pattern: label, count, source: sourceLabel }, 'Stripped injection pattern from user content');
        }
        safe = safe.replace(pattern, '[REDACTED]');
      }
    }

    // Check for unusually long content that could contain encoded injections
    if (raw.length > 50_000) {
      warnings.push(`Content exceeds 50KB (${(raw.length / 1024).toFixed(1)}KB) — may contain encoded injection vectors`);
    }

    // Check for base64-encoded blocks that could hide injection payloads
    const base64Blocks = raw.match(/[A-Za-z0-9+/]{40,}={0,2}/g);
    if (base64Blocks && base64Blocks.length >= 3) {
      warnings.push(`Contains ${base64Blocks.length} base64-encoded blocks — possible encoded injection`);
    }

    return {
      safePrompt: safe,
      strippedPatterns,
      warnings,
    };
  }
}

/**
 * Convenience function for one-shot sanitization.
 */
export function sanitizePrompt(raw: string): string {
  const sanitizer = new PromptSanitizer();
  const result = sanitizer.sanitizeIssueBody(raw);
  if (result.strippedPatterns.length > 0) {
    log.info({ stripped: result.strippedPatterns }, 'Sanitized prompt');
  }
  return result.safePrompt;
}
