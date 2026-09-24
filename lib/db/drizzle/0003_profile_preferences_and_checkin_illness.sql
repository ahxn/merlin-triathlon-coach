ALTER TABLE "athletes"
  ADD COLUMN IF NOT EXISTS "availability_days" text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "preferences" jsonb NOT NULL DEFAULT '{"coachTone":"Warm + direct","notifications":true}'::jsonb;
--> statement-breakpoint
ALTER TABLE "check_ins"
  ADD COLUMN IF NOT EXISTS "illness_signal" text;
