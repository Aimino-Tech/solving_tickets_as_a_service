/**
 * Drizzle Kit configuration.
 *
 * Schema: src/db/schema/index.ts
 * Migrations: src/db/migrations
 * Driver: pg (node-postgres)
 */

import { defineConfig } from 'drizzle-kit';
import 'dotenv/config';

export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://localhost:5432/stas',
  },
});
