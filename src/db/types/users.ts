export interface User {
  id: number;
  email: string;
  passwordHash: string;
  name: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewUser {
  email: string;
  passwordHash: string;
  name?: string | null;
}
