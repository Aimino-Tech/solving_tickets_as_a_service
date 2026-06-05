import { tool } from "@opencode-ai/plugin";
import { z } from "zod";

const ENDPOINT = process.env.SYMPHONY_LINEAR_ENDPOINT || "https://api.linear.app/graphql";
const API_KEY = process.env.SYMPHONY_LINEAR_API_KEY;
const MISSING_QUERY_PAYLOAD = "{\n  \"error\": {\n    \"message\": \"`linear_graphql` requires a non-empty `query` string.\"\n  }\n}";
const MISSING_API_KEY_PAYLOAD = "{\n  \"error\": {\n    \"message\": \"Symphony is missing Linear auth. Set `tracker.api_key` in `symphony.yml` or export `LINEAR_API_KEY`.\"\n  }\n}";
const TRANSPORT_FAILURE_MESSAGE = "Linear GraphQL request failed before receiving a successful response.";
const HTTP_FAILURE_PREFIX = "Linear GraphQL request failed with HTTP ";

const format = (value: unknown) => JSON.stringify(value, null, 2);

const fail = (payload: unknown): never => {
  throw new Error(format(payload));
};

export default tool({
  description: "Execute a raw GraphQL query or mutation against Linear using Symphony's configured auth.\n",
  args: {
    query: z.string().min(1),
    variables: z.record(z.string(), z.unknown()).nullable().optional(),
  },
  async execute(args) {
    const query = args.query.trim();

    if (!query) {
      fail(JSON.parse(MISSING_QUERY_PAYLOAD));
    }

    if (!API_KEY) {
      fail(JSON.parse(MISSING_API_KEY_PAYLOAD));
    }

    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          variables: args.variables ?? {},
        }),
      });

      const json = await response.json();

      if (!response.ok) {
        fail({
          error: {
            message: `${HTTP_FAILURE_PREFIX}${response.status}.`,
            status: response.status,
            body: json,
          },
        });
      }

      if (Array.isArray(json?.errors) && json.errors.length > 0) {
        fail(json);
      }

      return format(json);
    } catch (error) {
      fail({
        error: {
          message: TRANSPORT_FAILURE_MESSAGE,
          reason: error instanceof Error ? error.message : String(error),
        },
      });
    }
  },
});
