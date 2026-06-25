export interface HealthCheck {
  id: number;
  status: string;
  responseTimeMs: number | null;
  checkedAt: Date;
}

export interface NewHealthCheck {
  status?: string;
  responseTimeMs?: number | null;
  checkedAt?: Date;
}
