import { z } from 'zod';

const retrySchema = z.object({
  maxAttempts: z.number().int().positive().max(10).default(3),
  delayMs: z.number().int().positive().max(3600000).default(30000),
});

export const stepSchema = z.object({
  name: z.string().min(1),
  command: z.string().min(1),
  session: z.enum(['new', 'reuse']).default('new'),
  retry: retrySchema.optional(),
});

export const templateSchema = z.object({
  name: z.string().min(1),
  labels: z.array(z.string()).min(1),
  phases: z.record(z.string(), z.array(stepSchema).min(1)).refine((val) => Object.keys(val).length > 0, {
    message: 'At least one phase is required',
  }),
  sessionMode: z.enum(['new', 'reuse', 'parallel']).optional().default('new'),
  retry: retrySchema.optional(),
});

export type ValidatedTemplate = z.infer<typeof templateSchema>;

export function validateTemplateYaml(data: unknown): ValidatedTemplate {
  return templateSchema.parse(data);
}

export class TemplateValidationError extends Error {
  constructor(message: string, public readonly issues: z.ZodIssue[]) {
    super(message);
    this.name = 'TemplateValidationError';
  }
}
