import { integer, jsonb, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

export const userProgressTable = pgTable("user_progress", {
  userId: varchar("user_id").primaryKey(),
  username: varchar("username").notNull().default(""),
  profileImageUrl: varchar("profile_image_url"),
  bestScore: integer("best_score").notNull().default(0),
  totalRuns: integer("total_runs").notNull().default(0),
  cigarettesSmoked: integer("cigarettes_smoked").notNull().default(0),
  prestigeLevel: integer("prestige_level").notNull().default(0),
  lifetimeCoins: integer("lifetime_coins").notNull().default(0),
  upgrades: jsonb("upgrades").notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type UserProgress = typeof userProgressTable.$inferSelect;
export type UpsertUserProgress = typeof userProgressTable.$inferInsert;
