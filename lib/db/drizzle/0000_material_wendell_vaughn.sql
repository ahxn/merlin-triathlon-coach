CREATE TYPE "public"."goal_type" AS ENUM('race', 'ftp', 'mile_time', 'other');--> statement-breakpoint
CREATE TYPE "public"."recommendation_status" AS ENUM('pending', 'approved', 'edited', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."sport" AS ENUM('swim', 'bike', 'run', 'strength', 'rest', 'other');--> statement-breakpoint
CREATE TYPE "public"."workout_status" AS ENUM('planned', 'completed', 'skipped');--> statement-breakpoint
CREATE TABLE "athletes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"timezone" text DEFAULT 'America/New_York' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "check_ins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"athlete_id" uuid NOT NULL,
	"check_in_date" date NOT NULL,
	"readiness" integer NOT NULL,
	"energy" integer,
	"soreness" integer,
	"stress" integer,
	"sleep_quality" integer,
	"sleep_duration" time,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "check_ins_readiness_range" CHECK ("check_ins"."readiness" between 1 and 10),
	CONSTRAINT "check_ins_energy_range" CHECK ("check_ins"."energy" is null or "check_ins"."energy" between 1 and 10),
	CONSTRAINT "check_ins_soreness_range" CHECK ("check_ins"."soreness" is null or "check_ins"."soreness" between 1 and 10),
	CONSTRAINT "check_ins_stress_range" CHECK ("check_ins"."stress" is null or "check_ins"."stress" between 1 and 10),
	CONSTRAINT "check_ins_sleep_quality_range" CHECK ("check_ins"."sleep_quality" is null or "check_ins"."sleep_quality" between 1 and 10)
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"athlete_id" uuid NOT NULL,
	"type" "goal_type" NOT NULL,
	"name" text NOT NULL,
	"target_date" date,
	"target_value" numeric,
	"target_unit" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recommendations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"athlete_id" uuid NOT NULL,
	"check_in_id" uuid,
	"status" "recommendation_status" DEFAULT 'pending' NOT NULL,
	"title" text NOT NULL,
	"reasoning" text NOT NULL,
	"proposed_changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"athlete_notes" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"athlete_id" uuid NOT NULL,
	"goal_id" uuid,
	"scheduled_date" date NOT NULL,
	"title" text NOT NULL,
	"sport" "sport" NOT NULL,
	"status" "workout_status" DEFAULT 'planned' NOT NULL,
	"duration_minutes" integer,
	"distance_km" numeric,
	"intensity" text,
	"description" text,
	"completed_at" timestamp with time zone,
	"external_source" text,
	"external_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workouts_duration_nonnegative" CHECK ("workouts"."duration_minutes" is null or "workouts"."duration_minutes" >= 0),
	CONSTRAINT "workouts_distance_nonnegative" CHECK ("workouts"."distance_km" is null or "workouts"."distance_km" >= 0)
);
--> statement-breakpoint
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_athlete_id_athletes_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_athlete_id_athletes_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_athlete_id_athletes_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_check_in_id_check_ins_id_fk" FOREIGN KEY ("check_in_id") REFERENCES "public"."check_ins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_athlete_id_athletes_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "athletes_email_unique" ON "athletes" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "check_ins_athlete_date_unique" ON "check_ins" USING btree ("athlete_id","check_in_date");--> statement-breakpoint
CREATE UNIQUE INDEX "workouts_external_source_id_unique" ON "workouts" USING btree ("external_source","external_id");