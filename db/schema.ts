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

export const services = sqliteTable('meal_services', {
  owner:text('owner').notNull(), date:text('date').notNull(), meal:text('meal').notNull(),
  meals:integer('meals').notNull(), productionGrams:integer('production_grams').notNull(),
  revision:integer('revision').notNull().default(1),
}, table=>[primaryKey({columns:[table.owner,table.date,table.meal]})]);

export const kitchens = sqliteTable('kitchens', {
  id:text('id').primaryKey(),
  owner:text('owner').notNull().unique(),
  createdAt:text('created_at').notNull(),
});
