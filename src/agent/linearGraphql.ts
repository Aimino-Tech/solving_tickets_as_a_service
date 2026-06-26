/**
 * Linear GraphQL queries for dependency resolution (AIM-2037).
 *
 * Fetches blockedBy relationships from Linear's GraphQL API
 * to build a dependency graph for pipeline execution ordering.
 */

import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import type { DependencyIssue } from './dependencyResolver.js';

const log = rootLogger.child({ module: 'linear-graphql' });

const LINEAR_API_URL = 'https://api.linear.app/graphql';

/**
 * Raw response shape from the Linear GraphQL blockedBy query.
 */
interface IssuesResponse {
  issues: {
    nodes: Array<{
      id: string;
      title: string;
      relations: {
        nodes: Array<{
          type: string;
          relatedIssue: {
            id: string;
            title: string;
          } | null;
        }>;
      };
    }>;
  };
}

/**
 * GraphQL query to fetch blockedBy relationships for a list of issues.
 *
 * The `relations` connection on an Issue returns IssueRelation objects:
 * - `type`: "blockedBy" | "blocks" | "relatedTo" | "duplicateOf"
 * - `relatedIssue`: The issue at the other end of the relation
 *
 * If issue A has a relation with type="blockedBy" to issue B,
 * then A is blocked by B (B must be resolved before A).
 */
const BLOCKED_BY_QUERY = `
  query GetBlockedByGraph($ids: [String!]!) {
    issues(filter: { id: { in: $ids } }) {
      nodes {
        id
        title
        relations {
          nodes {
            type
            relatedIssue {
              id
              title
            }
          }
        }
      }
    }
  }
`;

/**
 * Fetch the blockedBy dependency graph for a list of Linear issues.
 *
 * For each issue, extracts all "blockedBy" relations and returns
 * a DependencyIssue array suitable for resolveDependencies().
 *
 * @param issueIds - Array of Linear issue IDs to fetch dependencies for
 * @returns Array of DependencyIssue with populated blockedBy arrays
 * @throws Error if LINEAR_API_KEY is not configured or API call fails
 */
export async function fetchBlockedByGraph(issueIds: string[]): Promise<DependencyIssue[]> {
  if (issueIds.length === 0) {
    return [];
  }

  const apiKey = config.trackers?.linear?.apiKey;
  if (!apiKey) {
    throw new Error('LINEAR_API_KEY is not configured. Set LINEAR_API_KEY in environment.');
  }

  log.info({ issueCount: issueIds.length }, 'Fetching blockedBy graph from Linear');

  const response = await fetch(LINEAR_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query: BLOCKED_BY_QUERY,
      variables: { ids: issueIds },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'unknown error');
    throw new Error(`Linear API error (${response.status}): ${errorText}`);
  }

  const body = (await response.json()) as {
    data?: IssuesResponse;
    errors?: Array<{ message: string }>;
  };

  if (body.errors?.length) {
    const messages = body.errors.map((e) => e.message).join('; ');
    throw new Error(`Linear GraphQL error: ${messages}`);
  }

  const nodes = body.data?.issues?.nodes ?? [];

  log.info({ fetchedIssues: nodes.length }, 'BlockedBy graph fetched from Linear');

  return nodes.map((node): DependencyIssue => ({
    id: node.id,
    title: node.title,
    blockedBy: (node.relations?.nodes ?? [])
      .filter((r) => r.type === 'blockedBy' && r.relatedIssue != null)
      .map((r) => r.relatedIssue!.id),
  }));
}

/**
 * Batch version of fetchBlockedByGraph that splits large issue lists
 * into batches to avoid Linear API query size limits.
 *
 * Linear's filter: { id: { in: $ids } } typically handles up to ~100 IDs.
 *
 * @param issueIds - Array of Linear issue IDs
 * @param batchSize - Max issues per query (default: 50)
 * @returns Combined DependencyIssue array
 */
export async function fetchBlockedByGraphBatched(
  issueIds: string[],
  batchSize = 50,
): Promise<DependencyIssue[]> {
  if (issueIds.length === 0) return [];

  const results: DependencyIssue[] = [];

  for (let i = 0; i < issueIds.length; i += batchSize) {
    const batch = issueIds.slice(i, i + batchSize);
    const batchResult = await fetchBlockedByGraph(batch);
    results.push(...batchResult);
  }

  return results;
}
