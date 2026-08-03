/**
 * Linear ticket confirmation for the Slack @syntaro mention handler.
 *
 * AIM-4460: before dispatching work for "fix AIM-1234", confirm the ticket
 * actually exists in Linear. A cheap `viewer` health query runs first so a
 * misconfigured API key fails fast instead of surfacing as "ticket missing".
 */

/** Linear GraphQL API endpoint. */
export const LINEAR_API_URL = 'https://api.linear.app/graphql';

/** Shape of a Linear issue state, as returned by the confirm query. */
export interface LinearTicketState {
  name: string;
  type: string;
}

/** Minimal Linear ticket data needed to build a work instruction. */
export interface LinearTicketInfo {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  url: string;
  state: LinearTicketState | null;
}

/** Confirms a Linear ticket identifier exists and returns its details. */
export interface TicketConfirmer {
  readonly name: string;
  confirm(identifier: string): Promise<LinearTicketInfo | null>;
}

/** Options for {@link createLinearTicketConfirmer}. */
export interface LinearTicketConfirmerOptions {
  /** Linear API key; defaults to SYMPHONY_LINEAR_API_KEY ?? LINEAR_API_KEY. */
  apiKey?: string;
  /** Injectable fetch for tests. */
  fetchImpl?: typeof fetch;
}

/**
 * Resolves the Linear API key from the environment. The OpenSymphony gateway
 * convention is SYMPHONY_LINEAR_API_KEY; the SYNTARO app also honours the legacy
 * LINEAR_API_KEY name. Reads `env` directly so tests never touch config.ts.
 */
export function resolveLinearApiKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.SYMPHONY_LINEAR_API_KEY ?? env.LINEAR_API_KEY;
}

/**
 * Creates a ticket confirmer backed by the Linear GraphQL API.
 *
 * `confirm(identifier)` runs a `viewer` health query first (so a bad key
 * rejects loudly), then an `issue(identifier:)` query. Returns the ticket
 * details, or `null` when the identifier does not exist.
 */
export function createLinearTicketConfirmer(opts: LinearTicketConfirmerOptions = {}): TicketConfirmer {
  const apiKey = opts.apiKey ?? resolveLinearApiKey();
  const fetchImpl = opts.fetchImpl ?? fetch;

  async function graphql<T>(query: string, variables: Record<string, string> | null = null): Promise<T> {
    if (!apiKey) {
      throw new Error('LINEAR_API_KEY is not configured');
    }
    const res = await fetchImpl(LINEAR_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: apiKey,
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Linear API error ${res.status}: ${body.slice(0, 300)}`);
    }
    const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
    if (json.errors?.length) {
      throw new Error(`Linear API error: ${json.errors[0].message}`);
    }
    return json.data as T;
  }

  return {
    name: 'linear',
    async confirm(identifier) {
      await graphql<{ viewer: { id: string } }>('query { viewer { id } }');
      const data = await graphql<{ issue: LinearTicketInfo | null }>(
        `query Issue($identifier: String!) {
          issue(identifier: $identifier) {
            id
            identifier
            title
            description
            url
            state { name type }
          }
        }`,
        { identifier },
      );
      return data.issue;
    },
  };
}
