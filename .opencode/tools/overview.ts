import { tool } from "@opencode-ai/plugin";
import { z } from "zod";

const ENDPOINT = process.env.SYMPHONY_SERVER_ENDPOINT || "http://127.0.0.1:4000";

const format = (value) => JSON.stringify(value, null, 2);

const tools = {
  compliance_score: {
    description: "Returns a compliance score (0-100), status (healthy/degraded/critical), and summary of agent activity.",
    args: {},
    async execute() {
      const response = await fetch(`${ENDPOINT}/api/v1/overview/compliance_score`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(format(data));
      }

      return format(data);
    },
  },
  policy_violations: {
    description: "Returns a human-readable list of policy violations including retries, excessive turns, high token usage, and rate limit pressure.",
    args: {},
    async execute() {
      const response = await fetch(`${ENDPOINT}/api/v1/overview/policy_violations`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(format(data));
      }

      return format(data);
    },
  },
  agent_status: {
    description: "Returns what each agent is currently doing: their identifier, project, backend, effort, session, turn count, and last event.",
    args: {},
    async execute() {
      const response = await fetch(`${ENDPOINT}/api/v1/overview/agent_status`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(format(data));
      }

      return format(data);
    },
  },
};

export default [
  tool(tools.compliance_score),
  tool(tools.policy_violations),
  tool(tools.agent_status),
];
