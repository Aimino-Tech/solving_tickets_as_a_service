/**
 * Feature flags types — per-account feature toggles.
 */

export interface FeatureFlag {
  id: number;
  accountId: number;
  flag: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewFeatureFlag {
  id?: number;
  accountId: number;
  flag: string;
  enabled?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}
