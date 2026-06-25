export interface RequestTiming {
  id: number;
  method: string | null;
  path: string | null;
  statusCode: number | null;
  durationMs: number;
  createdAt: Date;
}

export interface NewRequestTiming {
  method?: string | null;
  path?: string | null;
  statusCode?: number | null;
  durationMs: number;
  createdAt?: Date;
}
