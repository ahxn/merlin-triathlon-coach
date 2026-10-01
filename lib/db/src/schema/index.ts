// Export your models here. Add one export per file
// export * from "./posts";
//
// Each model/table should ideally be split into different files.
// Each model/table should define a Drizzle table, insert schema, and types:
//
//   import { pgTable, text, serial } from "drizzle-orm/pg-core";
//   import { createInsertSchema } from "drizzle-zod";
//   import { z } from "zod/v4";
//
//   export const postsTable = pgTable("posts", {
//     id: serial("id").primaryKey(),
//     title: text("title").notNull(),
//   });
//
//   export const insertPostSchema = createInsertSchema(postsTable).omit({ id: true });
//   export type InsertPost = z.infer<typeof insertPostSchema>;
//   export type Post = typeof postsTable.$inferSelect;

import { relations, sql } from "drizzle-orm";
import { check, date, index, integer, jsonb, numeric, pgEnum, pgTable, text, time, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

export const sportEnum = pgEnum("sport", ["swim", "bike", "run", "strength", "rest", "other"]);
export const workoutStatusEnum = pgEnum("workout_status", ["planned", "completed", "skipped"]);
export const goalTypeEnum = pgEnum("goal_type", ["race", "ftp", "mile_time", "other"]);
export const recommendationStatusEnum = pgEnum("recommendation_status", ["pending", "approved", "edited", "dismissed"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const athletes = pgTable("athletes", {
  id: uuid("id").defaultRandom().primaryKey(),
  authUserId: uuid("auth_user_id").unique(),
  name: text("name").notNull(),
  email: text("email"),
  timezone: text("timezone").default("America/New_York").notNull(),
  availabilityDays: text("availability_days").array().default([]).notNull(),
  preferences: jsonb("preferences").$type<{ coachTone: string; notifications: boolean; plan?: Record<string, unknown> }>().default({ coachTone: "Warm + direct", notifications: true }).notNull(),
  ...timestamps,
}, (table) => [uniqueIndex("athletes_email_unique").on(table.email)]);

export const userApiCredentials = pgTable("user_api_credentials", {
  authUserId: uuid("auth_user_id").primaryKey(),
  intervalsAthleteId: text("intervals_athlete_id").notNull(),
  apiKeyCiphertext: text("api_key_ciphertext").notNull(),
  apiKeyIv: text("api_key_iv").notNull(),
  apiKeyAuthTag: text("api_key_auth_tag").notNull(),
  ...timestamps,
});

export const goals = pgTable("goals", {
  id: uuid("id").defaultRandom().primaryKey(),
  athleteId: uuid("athlete_id").notNull().references(() => athletes.id, { onDelete: "cascade" }),
  type: goalTypeEnum("type").notNull(),
  name: text("name").notNull(),
  targetDate: date("target_date", { mode: "string" }),
  targetValue: numeric("target_value"),
  targetUnit: text("target_unit"),
  notes: text("notes"),
  ...timestamps,
}, (table) => [index("goals_athlete_target_date_idx").on(table.athleteId, table.targetDate)]);

export const workouts = pgTable("workouts", {
  id: uuid("id").defaultRandom().primaryKey(),
  athleteId: uuid("athlete_id").notNull().references(() => athletes.id, { onDelete: "cascade" }),
  goalId: uuid("goal_id").references(() => goals.id, { onDelete: "set null" }),
  scheduledDate: date("scheduled_date", { mode: "string" }).notNull(),
  title: text("title").notNull(),
  sport: sportEnum("sport").notNull(),
  status: workoutStatusEnum("status").default("planned").notNull(),
  durationMinutes: integer("duration_minutes"),
  distanceKm: numeric("distance_km"),
  intensity: text("intensity"),
  description: text("description"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  externalSource: text("external_source"),
  externalId: text("external_id"),
  ...timestamps,
}, (table) => [
  uniqueIndex("workouts_external_source_id_unique").on(table.externalSource, table.externalId),
  index("workouts_athlete_scheduled_date_idx").on(table.athleteId, table.scheduledDate),
  index("workouts_goal_id_idx").on(table.goalId),
  check("workouts_duration_nonnegative", sql`${table.durationMinutes} is null or ${table.durationMinutes} >= 0`),
  check("workouts_distance_nonnegative", sql`${table.distanceKm} is null or ${table.distanceKm} >= 0`),
]);

export const checkIns = pgTable("check_ins", {
  id: uuid("id").defaultRandom().primaryKey(),
  athleteId: uuid("athlete_id").notNull().references(() => athletes.id, { onDelete: "cascade" }),
  checkInDate: date("check_in_date", { mode: "string" }).notNull(),
  readiness: integer("readiness").notNull(),
  energy: integer("energy"),
  soreness: integer("soreness"),
  stress: integer("stress"),
  sleepQuality: integer("sleep_quality"),
  sleepDuration: time("sleep_duration"),
  illnessSignal: text("illness_signal"),
  notes: text("notes"),
  ...timestamps,
}, (table) => [
  uniqueIndex("check_ins_athlete_date_unique").on(table.athleteId, table.checkInDate),
  check("check_ins_readiness_range", sql`${table.readiness} between 1 and 10`),
  check("check_ins_energy_range", sql`${table.energy} is null or ${table.energy} between 1 and 10`),
  check("check_ins_soreness_range", sql`${table.soreness} is null or ${table.soreness} between 1 and 10`),
  check("check_ins_stress_range", sql`${table.stress} is null or ${table.stress} between 1 and 10`),
  check("check_ins_sleep_quality_range", sql`${table.sleepQuality} is null or ${table.sleepQuality} between 1 and 10`),
]);

export type RecommendationChange = { workoutId?: string; field: string; from?: unknown; to: unknown };

export const recommendations = pgTable("recommendations", {
  id: uuid("id").defaultRandom().primaryKey(),
  athleteId: uuid("athlete_id").notNull().references(() => athletes.id, { onDelete: "cascade" }),
  checkInId: uuid("check_in_id").references(() => checkIns.id, { onDelete: "set null" }),
  status: recommendationStatusEnum("status").default("pending").notNull(),
  title: text("title").notNull(),
  reasoning: text("reasoning").notNull(),
  proposedChanges: jsonb("proposed_changes").$type<RecommendationChange[]>().default([]).notNull(),
  athleteNotes: text("athlete_notes"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [
  index("recommendations_athlete_created_at_idx").on(table.athleteId, table.createdAt),
  index("recommendations_check_in_id_idx").on(table.checkInId),
]);

export const athletesRelations = relations(athletes, ({ many }) => ({ goals: many(goals), workouts: many(workouts), checkIns: many(checkIns), recommendations: many(recommendations) }));
export const goalsRelations = relations(goals, ({ one, many }) => ({ athlete: one(athletes, { fields: [goals.athleteId], references: [athletes.id] }), workouts: many(workouts) }));
export const workoutsRelations = relations(workouts, ({ one }) => ({ athlete: one(athletes, { fields: [workouts.athleteId], references: [athletes.id] }), goal: one(goals, { fields: [workouts.goalId], references: [goals.id] }) }));
export const checkInsRelations = relations(checkIns, ({ one, many }) => ({ athlete: one(athletes, { fields: [checkIns.athleteId], references: [athletes.id] }), recommendations: many(recommendations) }));
export const recommendationsRelations = relations(recommendations, ({ one }) => ({ athlete: one(athletes, { fields: [recommendations.athleteId], references: [athletes.id] }), checkIn: one(checkIns, { fields: [recommendations.checkInId], references: [checkIns.id] }) }));

export const insertAthleteSchema = createInsertSchema(athletes).omit({ id: true, authUserId: true, createdAt: true, updatedAt: true });
export const insertGoalSchema = createInsertSchema(goals).omit({ id: true, createdAt: true, updatedAt: true });
export const insertWorkoutSchema = createInsertSchema(workouts).omit({ id: true, createdAt: true, updatedAt: true });
export const insertCheckInSchema = createInsertSchema(checkIns).omit({ id: true, createdAt: true, updatedAt: true });
export const insertRecommendationSchema = createInsertSchema(recommendations).omit({ id: true, createdAt: true, updatedAt: true });

export const selectAthleteSchema = createSelectSchema(athletes);
export const selectGoalSchema = createSelectSchema(goals);
export const selectWorkoutSchema = createSelectSchema(workouts);
export const selectCheckInSchema = createSelectSchema(checkIns);
export const selectRecommendationSchema = createSelectSchema(recommendations);

export type Athlete = typeof athletes.$inferSelect;
export type Goal = typeof goals.$inferSelect;
export type Workout = typeof workouts.$inferSelect;
export type CheckIn = typeof checkIns.$inferSelect;
export type Recommendation = typeof recommendations.$inferSelect;
