/**
 * Teams types — multi-tenant team management.
 */

export interface Team {
  id: number;
  name: string;
  slug: string;
  ownerAccountId: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewTeam {
  id?: number;
  name: string;
  slug: string;
  ownerAccountId: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface TeamMember {
  id: number;
  teamId: number;
  accountId: number;
  role: string;
  joinedAt: Date;
}

export interface NewTeamMember {
  id?: number;
  teamId: number;
  accountId: number;
  role?: string;
  joinedAt?: Date;
}
