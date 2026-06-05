/**
 * Teams schema — multi-tenant team management.
 *
 * Teams allow grouping of accounts for shared billing and management.
 * Each team has one owner (the account that created it).
 * Members are accounts that belong to a team with a specific role.
 */

import { integer, pgTable, serial, timestamp, varchar, unique } from 'drizzle-orm/pg-core';
import { accounts } from './accounts.js';

export const teams = pgTable('teams', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 255 }).notNull().unique(),
  ownerAccountId: integer('owner_account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const teamMembers = pgTable(
  'team_members',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    accountId: integer('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 50 }).notNull().default('member'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueMembership: unique().on(table.teamId, table.accountId),
  }),
);

export type Team = typeof teams.$inferSelect;
export type NewTeam = typeof teams.$inferInsert;
export type TeamMember = typeof teamMembers.$inferSelect;
export type NewTeamMember = typeof teamMembers.$inferInsert;
