const FORBIDDEN_PATTERNS = ['SandboxExecutor', 'qualityGates', 'ActionDispatcher'];

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Block mock imports of core infrastructure modules',
      recommended: true,
    },
    schema: [
      {
        type: 'object',
        properties: {
          forbiddenPatterns: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const options = context.options[0] || {};
    const patterns = options.forbiddenPatterns || FORBIDDEN_PATTERNS;

    return {
      CallExpression(node) {
        if (node.callee.type !== 'MemberExpression') return;
        if (node.callee.property?.name !== 'mock') return;
        if (node.arguments.length < 1) return;
        const arg = node.arguments[0];
        if (arg.type !== 'Literal' && arg.type !== 'TemplateLiteral') return;
        const mockPath = arg.type === 'Literal' ? String(arg.value) : '';
        for (const pattern of patterns) {
          if (mockPath.includes(pattern)) {
            context.report({
              node,
              message: `DO NOT mock core infrastructure module "{{pattern}}" — use real execution tests`,
              data: { pattern },
            });
          }
        }
      },
      ImportDeclaration(node) {
        const importPath = node.source.value || '';
        for (const pattern of patterns) {
          if (importPath.includes(pattern)) {
            context.report({
              node,
              message: `DO NOT import mock of "{{pattern}}" directly — use real execution tests`,
              data: { pattern },
            });
          }
        }
      },
    };
  },
};
