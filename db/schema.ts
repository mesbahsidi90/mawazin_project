import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core';

export const records = sqliteTable('waste_records', {
  owner: text('owner').notNull(),
  id: text('id').notNull(),
  timestamp: text('timestamp').notNull(),
  food: text('food').notNull(),
  stage: text('stage').notNull(),
  reason: text('reason').notNull(),
  meal: text('meal').notNull(),
  grams: integer('grams').notNull(),
  unitCost: integer('unit_cost').notNull(),
  cost: integer('cost').notNull(),
  source: text('source').notNull(),
  note: text('note').notNull().default(''),
}, table => [primaryKey({columns:[table.owner, table.id]}), index('idx_waste_owner_time').on(table.owner, table.timestamp)]);

export const settings = sqliteTable('user_settings', {
  owner: text('owner').primaryKey(),
  payload: text('payload').notNull(),
  revision: integer('revision').notNull().default(1),
});
