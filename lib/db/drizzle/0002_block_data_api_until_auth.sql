-- The Express API is the only application data path for the foundation phase.
-- Keep Supabase's public Data API roles explicitly blocked until user auth and
-- athlete ownership policies are implemented together.
REVOKE ALL ON TABLE "athletes", "goals", "workouts", "check_ins", "recommendations" FROM anon, authenticated;
--> statement-breakpoint
CREATE POLICY "athletes_block_data_api_until_auth" ON "athletes"
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
--> statement-breakpoint
CREATE POLICY "goals_block_data_api_until_auth" ON "goals"
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
--> statement-breakpoint
CREATE POLICY "workouts_block_data_api_until_auth" ON "workouts"
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
--> statement-breakpoint
CREATE POLICY "check_ins_block_data_api_until_auth" ON "check_ins"
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
--> statement-breakpoint
CREATE POLICY "recommendations_block_data_api_until_auth" ON "recommendations"
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
