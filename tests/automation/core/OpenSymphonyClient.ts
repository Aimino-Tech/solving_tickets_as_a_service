export interface DispatchParams {
  issueId: string;
  repo: string;
  tenant?: string;
  title: string;
  body: string;
  labels?: string[];
  source?: string;
  trackerType?: string;
  trackerTicketId?: string;
  installationId?: number;
}

export interface DispatchResult {
  success: boolean;
  runId?: string;
  prUrl?: string;
  summary?: string;
  errors?: string[];
}

export interface HealthStatus {
  status: string;
  version?: string;
  uptime?: number;
  services?: Record<string, string>;
}

export class OpenSymphonyClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl?: string, apiKey?: string) {
    this.baseUrl = (baseUrl || process.env.OSY_URL || 'http://localhost:4096').replace(/\/+$/, '');
    this.apiKey = apiKey || process.env.OSY_API_KEY || '';
  }

  async health(): Promise<HealthStatus> {
    const resp = await fetch(`${this.baseUrl}/healthz`);
    if (!resp.ok && resp.status !== 503) {
      throw new Error(`OpenSymphony health check failed: ${resp.status}`);
    }
    return resp.json() as Promise<HealthStatus>;
  }

  async isAlive(): Promise<boolean> {
    try {
      const resp = await fetch(`${this.baseUrl}/healthz`, { signal: AbortSignal.timeout(5000) });
      return resp.ok || resp.status === 503;
    } catch {
      return false;
    }
  }

  async dispatch(params: DispatchParams): Promise<DispatchResult> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers['X-API-Key'] = this.apiKey;
    }

    const payload = {
      issue_id: params.issueId,
      repo: params.repo,
      tenant: params.tenant || 'default',
      title: params.title,
      body: params.body,
      labels: params.labels || [],
      source: params.source || 'github',
      tracker_type: params.trackerType || 'github',
      tracker_ticket_id: params.trackerTicketId || params.issueId,
      installation_id: params.installationId || 0,
    };

    try {
      const resp = await fetch(`${this.baseUrl}/api/v1/dispatch`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000),
      });

      if (!resp.ok) {
        const errorText = await resp.text().catch(() => 'unknown error');
        return { success: false, errors: [`HTTP ${resp.status}: ${errorText}`] };
      }

      const result = (await resp.json()) as Record<string, unknown>;
      return {
        success: true,
        runId: String(result.run_id || ''),
        prUrl: result.pr_url ? String(result.pr_url) : undefined,
        summary: String(result.summary || 'Dispatched to OpenSymphony'),
      };
    } catch (err) {
      return { success: false, errors: [String(err)] };
    }
  }

  async getDispatchStatus(runId: string): Promise<DispatchResult> {
    const headers: Record<string, string> = {};
    if (this.apiKey) headers['X-API-Key'] = this.apiKey;

    try {
      const resp = await fetch(`${this.baseUrl}/api/v1/dispatch/${runId}/status`, {
        headers,
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) {
        return { success: false, errors: [`HTTP ${resp.status}`] };
      }
      const data = (await resp.json()) as Record<string, unknown>;
      return {
        success: data.status === 'completed',
        runId,
        summary: String(data.status || ''),
        prUrl: data.pr_url ? String(data.pr_url) : undefined,
      };
    } catch (err) {
      return { success: false, errors: [String(err)] };
    }
  }

  async getDispatchResult(runId: string): Promise<DispatchResult> {
    const headers: Record<string, string> = {};
    if (this.apiKey) headers['X-API-Key'] = this.apiKey;

    try {
      const resp = await fetch(`${this.baseUrl}/api/v1/dispatch/${runId}/result`, {
        headers,
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) {
        return { success: false, errors: [`HTTP ${resp.status}`] };
      }
      const data = (await resp.json()) as Record<string, unknown>;
      return {
        success: true,
        runId,
        prUrl: data.pr_url ? String(data.pr_url) : undefined,
        summary: JSON.stringify(data),
      };
    } catch (err) {
      return { success: false, errors: [String(err)] };
    }
  }
}
