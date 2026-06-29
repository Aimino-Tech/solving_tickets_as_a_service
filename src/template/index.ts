export { templateRegistry } from './templateRegistry.js';
export { registerDefaultTemplates } from './defaultTemplates.js';
export { validateTemplateYaml, dryRunResolve, preflightValidate } from './validator.js';
export { getKnownPlaceholders, extractPlaceholders, suggestPlaceholder, validatePlaceholders } from './placeholderRegistry.js';
export type {
  TemplateVariable,
  TemplateDefinition,
  TemplateRegistryEntry,
  JobTemplate,
} from './types.js';
export type {
  ValidationError,
  ValidationResult,
  TemplateCommand,
  TemplatePhase,
  TemplateYaml,
} from './validator.js';
export type {
  PlaceholderDefinition,
} from './placeholderRegistry.js';
