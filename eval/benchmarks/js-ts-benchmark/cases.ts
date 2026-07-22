export interface JsTsTestCase {
  name: string;
  category: string;
  description: string;
  repoContext: string;
  issueTitle: string;
  issueBody: string;
  expectedOutcome: string;
  expectedFiles: string[];
}

export const JS_TS_TEST_CASES: JsTsTestCase[] = [
  {
    name: 'JS/TS: React stale closure in useEffect',
    category: 'react-bug',
    description:
      'Fix stale closure in React useEffect where state variable is captured at render time and never updated',
    repoContext: 'React component with useEffect that has an empty dependency array but references state',
    issueTitle: 'useEffect has stale closure — counter never updates past initial value',
    issueBody:
      'The counter in MyComponent never increments past 0 because the closure in useEffect captures the initial value. Fix the dependency array.',
    expectedOutcome: 'Add correct dependencies to useEffect or use useRef for latest value',
    expectedFiles: ['src/components/MyComponent.tsx'],
  },
  {
    name: 'JS/TS: TypeScript strict null check failure',
    category: 'typescript-bug',
    description: 'Fix TypeScript strict mode error where optional property is accessed without null check',
    repoContext: 'TypeScript project with strict: true in tsconfig',
    issueTitle: 'TS2532: Object is possibly undefined when accessing user.profile.name',
    issueBody: 'user.profile is optional but code accesses .name without optional chaining. Fix all occurrences.',
    expectedOutcome: 'Add optional chaining or proper null check for user.profile access',
    expectedFiles: ['src/services/userService.ts'],
  },
  {
    name: 'JS/TS: Async error swallowed in Promise chain',
    category: 'async-bug',
    description: 'Fix unhandled promise rejection where async error is not caught in Promise.all',
    repoContext: 'Express API handler using Promise.all for parallel data fetching',
    issueTitle: 'Unhandled promise rejection when one of parallel API calls fails',
    issueBody: 'Promise.all rejects entirely when one call fails. Should handle partial failures gracefully.',
    expectedOutcome: 'Use Promise.allSettled or add per-call catch handlers',
    expectedFiles: ['src/api/handlers/dashboard.ts'],
  },
  {
    name: 'JS/TS: Missing key prop in list rendering',
    category: 'react-bug',
    description: 'Add missing key prop to React list rendering to prevent unnecessary re-renders',
    repoContext: 'React component rendering a list of items using array index as key',
    issueTitle: 'List re-renders all items when only one changes — missing stable key',
    issueBody: 'Using index as key causes unnecessary re-renders. Use unique id from data instead.',
    expectedOutcome: 'Replace index key with unique identifier from item data',
    expectedFiles: ['src/components/ItemList.tsx'],
  },
  {
    name: 'JS/TS: Memory leak from setInterval not cleared',
    category: 'react-bug',
    description: 'Fix memory leak by clearing setInterval in useEffect cleanup',
    repoContext: 'React component with polling logic using setInterval in useEffect',
    issueTitle: 'Memory leak: setInterval continues after component unmounts',
    issueBody: 'The polling interval keeps running even when the component is unmounted. Add cleanup.',
    expectedOutcome: 'Return cleanup function from useEffect that clears the interval',
    expectedFiles: ['src/hooks/usePolling.ts'],
  },
  {
    name: 'JS/TS: Deep clone mutation of shared state',
    category: 'state-management',
    description: 'Fix unintentional mutation of shared state due to shallow copy in Redux reducer',
    repoContext: 'Redux toolkit with immer but some reducers mutate state directly',
    issueTitle: 'State mutation bug — shallow copy allows sibling components to corrupt shared data',
    issueBody:
      'The reducer uses spread operator for nested state but only does shallow copy. Use structuredClone or Immer.',
    expectedOutcome: 'Replace shallow copy with deep clone or Immer produce',
    expectedFiles: ['src/store/slices/userSlice.ts'],
  },
  {
    name: 'JS/TS: Express middleware order vulnerability',
    category: 'express-bug',
    description: 'Fix middleware ordering where auth check comes after error handler',
    repoContext: 'Express app with middleware registration in wrong order',
    issueTitle: 'Security: error handler registered before auth middleware — errors leak stack traces',
    issueBody:
      'The global error handler is placed before auth middleware, so auth errors bypass normal handling. Reorder middleware.',
    expectedOutcome: 'Move error handler to last position, after all route middleware',
    expectedFiles: ['src/index.ts'],
  },
  {
    name: 'JS/TS: Race condition in file upload with progress',
    category: 'async-bug',
    description: 'Fix race condition where multiple file uploads overwrite shared progress state',
    repoContext: 'File upload component tracking progress in a single state variable',
    issueTitle: 'Concurrent uploads show incorrect progress — state race condition',
    issueBody:
      'When uploading multiple files at once, progress jumps erratically because all uploads update the same state.',
    expectedOutcome: 'Use per-file progress tracking instead of single shared state',
    expectedFiles: ['src/components/FileUpload.tsx'],
  },
  {
    name: 'JS/TS: Next.js getServerSideProps missing error handling',
    category: 'nextjs-bug',
    description: 'Add error handling in getServerSideProps to show 404 page on API failure',
    repoContext: 'Next.js page with getServerSideProps that crashes on API failure',
    issueTitle: 'Server-side error: unhandled API failure crashes the page',
    issueBody: 'When the external API is down, getServerSideProps throws instead of returning notFound: true.',
    expectedOutcome: 'Wrap API call in try/catch, return notFound or redirect on error',
    expectedFiles: ['src/pages/product/[id].tsx'],
  },
  {
    name: 'JS/TS: WebSocket reconnection exponential backoff',
    category: 'websocket-bug',
    description: 'Fix WebSocket reconnection that retries too aggressively without backoff',
    repoContext: 'WebSocket client with naive retry that floods the server on disconnect',
    issueTitle: 'WebSocket reconnection floods server with connection attempts on disconnect',
    issueBody:
      'When connection drops, the client reconnects every 100ms with no backoff. Implement exponential backoff.',
    expectedOutcome: 'Implement exponential backoff with jitter for reconnection attempts',
    expectedFiles: ['src/services/websocketClient.ts'],
  },
  {
    name: 'JS/TS: CSS specificity conflict with Tailwind classes',
    category: 'css-bug',
    description: 'Fix CSS specificity issue where custom styles override Tailwind utility classes in wrong order',
    repoContext: 'Next.js project using both Tailwind and custom CSS modules',
    issueTitle: 'CSS specificity: custom .card styles override Tailwind border utilities',
    issueBody: 'Custom CSS defined after Tailwind import has higher specificity, breaking utility class overrides.',
    expectedOutcome: 'Fix import order or use Tailwind @layer directive',
    expectedFiles: ['src/styles/globals.css', 'src/components/Card.tsx'],
  },
  {
    name: 'JS/TS: Zod validation schema mismatch with TypeScript types',
    category: 'typescript-bug',
    description: 'Fix Zod schema that diverges from TypeScript interface definition',
    repoContext: 'TypeScript API project using Zod for runtime validation',
    issueTitle: 'Zod schema allows null but TypeScript type requires string — runtime vs type mismatch',
    issueBody:
      'The API endpoint receives null for a field that the TS type says is required string. The Zod schema is too permissive.',
    expectedOutcome: 'Align Zod schema with TypeScript types, add proper validation',
    expectedFiles: ['src/api/schemas/userSchema.ts', 'src/api/types/user.ts'],
  },
  {
    name: 'JS/TS: Bundle size — moment.js should be date-fns',
    category: 'perf-bug',
    description: 'Replace moment.js with date-fns to reduce bundle size',
    repoContext: 'Next.js app with moment.js adding 200KB+ to bundle',
    issueTitle: 'Performance: moment.js adds 231KB to bundle — migrate to date-fns',
    issueBody:
      'moment.js is used in only 3 files but adds 231KB to the JS bundle. Replace with date-fns (tree-shakeable).',
    expectedOutcome: 'Replace moment.js imports with date-fns equivalents',
    expectedFiles: ['src/utils/dateFormat.ts', 'src/components/Calendar.tsx', 'src/services/dateService.ts'],
  },
  {
    name: 'JS/TS: Jest mock not reset between tests',
    category: 'testing-bug',
    description: 'Fix test pollution where module mock state leaks between test cases',
    repoContext: 'Jest test suite with shared mocks causing test interdependence',
    issueTitle: 'Tests fail when run together but pass individually — mock state leakage',
    issueBody: 'API mock returns previous test data because mockImplementation is not reset in beforeEach.',
    expectedOutcome: 'Add jest.resetAllMocks() or jest.clearAllMocks() in beforeEach',
    expectedFiles: ['src/__tests__/api.test.ts'],
  },
  {
    name: 'JS/TS: Error boundary catches but does not log',
    category: 'react-bug',
    description: 'Add error logging to React Error Boundary componentDidCatch',
    repoContext: 'React app with ErrorBoundary that silently catches errors',
    issueTitle: 'ErrorBoundary swallows errors without logging — debugging is impossible',
    issueBody: 'The ErrorBoundary componentDidCatch is empty. Errors are hidden from developers.',
    expectedOutcome: 'Add console.error and optional external error reporting call',
    expectedFiles: ['src/components/ErrorBoundary.tsx'],
  },
];

export const JS_TS_SAMPLE_COUNT = JS_TS_TEST_CASES.length;
