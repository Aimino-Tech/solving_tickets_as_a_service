export { registerDefaultTemplates } from './defaultTemplates.js';
export type { PlaceholderDefinition } from './placeholderRegistry.js';
export {
  extractPlaceholders,
  getKnownPlaceholders,
  suggestPlaceholder,
  validatePlaceholders,
} from './placeholderRegistry.js';
export { templateRegistry } from './templateRegistry.js';
export type {
  JobTemplate,
  TemplateDefinition,
  TemplateRegistryEntry,
  TemplateVariable,
} from './types.js';
export type {
  TemplateCommand,
  TemplatePhase,
  TemplateYaml,
  ValidationError,
  ValidationResult,
} from './validator.js';
export { dryRunResolve, preflightValidate, validateTemplateYaml } from './validator.js';
