export interface ProviderOptions {
  id?: string;
  label?: string;
  config?: {
    sandboxTemplate?: string;
    timeoutMs?: number;
    model?: string;
    basePath?: string;
    [key: string]: unknown;
  };
  prompts?: string[];
  transform?: string;
  delay?: number;
  env?: Record<string, string | undefined>;
}

export interface ProviderResponse {
  output?: string;
  error?: string;
  cost?: number;
  tokenUsage?: {
    total?: number;
    prompt?: number;
    completion?: number;
  };
  cached?: boolean;
  metadata?: Record<string, unknown>;
}

export interface CallApiContextParams {
  vars?: Record<string, string | object>;
  prompt?: { label?: string; raw?: string };
  debug?: boolean;
}

export interface CallApiOptionsParams {
  includeLogProbs?: boolean;
}

const OPENCODE_URL = process.env.OPENCODE_URL || "http://localhost:4096";

export class StasAgentProvider {
  private providerConfig: ProviderOptions["config"];

  constructor(options: ProviderOptions) {
    this.providerConfig = options.config || {};
  }

  id(): string {
    return `stas-agent:${this.providerConfig?.model || "opencode-go/deepseek-v4-flash"}`;
  }

  async callApi(
    prompt: string,
    context?: CallApiContextParams,
    _options?: CallApiOptionsParams,
  ): Promise<ProviderResponse> {
    const sandboxTemplate = this.providerConfig?.sandboxTemplate || "stas-eval";
    const timeoutMs = this.providerConfig?.timeoutMs || 300000;
    const model = this.providerConfig?.model || "opencode-go/deepseek-v4-flash";

    try {
      const response = await fetch(`${OPENCODE_URL}/api/agent/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          model,
          sandboxTemplate,
          timeoutMs,
          vars: context?.vars || {},
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        return { error: `OpenCode agent returned ${response.status}: ${errorText}` };
      }

      const result = await response.json();
      return {
        output: typeof result.output === "string" ? result.output : JSON.stringify(result),
        metadata: { sandboxTemplate, model, ...result.metadata },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { error: `Failed to run STAS agent: ${message}` };
    }
  }
}

export default StasAgentProvider;
