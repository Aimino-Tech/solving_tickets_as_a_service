/**
 * Repos types — repositories tracked per account.
 */

export interface Repo {
  id: number;
  owner: string;
  name: string;
  installationId: number;
  accountId: number;
  enabledAt: Date;
}

export interface NewRepo {
  id?: number;
  owner: string;
  name: string;
  installationId: number;
  accountId: number;
  enabledAt?: Date;
}
