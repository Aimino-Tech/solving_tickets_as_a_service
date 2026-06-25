/**
 * Accounts types — GitHub App installations and their owners.
 *
 * Each account represents a GitHub user or org that has authorized the STAS app.
 * The plan field determines credit pricing and rate limits for the hosted service.
 */

export interface Account {
  id: number;
  githubUserId: number | null;
  githubInstallationId: number;
  githubAppInstallationId: number | null;
  email: string | null;
  name: string | null;
  plan: string;
  tier: string;
  trialEndsAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewAccount {
  id?: number;
  githubUserId?: number | null;
  githubInstallationId: number;
  githubAppInstallationId?: number | null;
  email?: string | null;
  name?: string | null;
  plan?: string;
  tier?: string;
  trialEndsAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}
