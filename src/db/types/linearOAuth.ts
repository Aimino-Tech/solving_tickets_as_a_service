export interface LinearOAuthToken {
  id: number;
  userId: string;
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string | null;
  linearUserId: string | null;
  linearUserName: string | null;
  linearUserEmail: string | null;
  scope: string | null;
  tokenExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewLinearOAuthToken {
  userId: string;
  accessTokenEncrypted: string;
  refreshTokenEncrypted?: string | null;
  linearUserId?: string | null;
  linearUserName?: string | null;
  linearUserEmail?: string | null;
  scope?: string | null;
  tokenExpiresAt?: Date | null;
}
