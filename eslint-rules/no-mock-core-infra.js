export default {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow mocking core infrastructure modules',
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
    const forbiddenPatterns = options.forbiddenPatterns || [];

    function checkMockCall(node, calleeName) {
      if (calleeName !== 'mock' && calleeName !== 'fn') return;

      const args = node.arguments;
      if (args.length === 0) return;

      const firstArg = args[0];
      if (!firstArg || firstArg.type !== 'Literal' || typeof firstArg.value !== 'string') return;

      const mockPath = firstArg.value;
      for (const pattern of forbiddenPatterns) {
        if (mockPath.includes(pattern)) {
          context.report({
            node,
            message: `DO NOT mock core infrastructure: '${mockPath}' references '${pattern}'. Use real sandbox execution instead.`,
          });
        }
      }
    }

    return {
      CallExpression(node) {
        if (node.callee.type !== 'MemberExpression') return;
        if (node.callee.object.type !== 'Identifier') return;
        const objectName = node.callee.object.name;
        if (objectName !== 'vi' && objectName !== 'jest') return;
        if (node.callee.property.type !== 'Identifier') return;
        checkMockCall(node, node.callee.property.name);
      },
    };
  },
};
