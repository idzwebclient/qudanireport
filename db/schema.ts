import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
export const ledgers = sqliteTable('ledgers', {
 userId: text('user_id').primaryKey(),
 payload: text('payload').notNull(),
 revision: integer('revision').notNull().default(0),
});
