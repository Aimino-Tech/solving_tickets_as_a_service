export interface EvalRunRequest {
  suite: 'smoke' | 'standard' | 'full';
  langfusePublicKey?: string;
  langfuseSecretKey?: string;
}

export interface EvalRunResponse {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  passRate?: number;
  passRateDelta?: number;
  langfuseTraceUrl?: string;
  regressionDetected?: boolean;
  error?: string;
}

const RETRY_DELAY_MS = 5_000;
const MAX_RETRIES = 5;

export class SyntaroApiClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
  }

  async triggerEval(request: EvalRunRequest): Promise<EvalRunResponse> {
    const res = await fetch(`${this.baseUrl}/api/v1/eval/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(request),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`SYNTARO API error (${res.status}): ${body}`);
    }

    return res.json() as Promise<EvalRunResponse>;
  }

  async pollEvalStatus(runId: string): Promise<EvalRunResponse> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const res = await fetch(`${this.baseUrl}/api/v1/eval/run/${runId}`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`SYNTARO API error (${res.status}): ${body}`);
      }

      const data = (await res.json()) as EvalRunResponse;

      if (data.status === 'completed' || data.status === 'failed') {
        return data;
      }

      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }

    throw new Error('Eval run timed out after maximum retries');
  }
}
