CREATE INDEX "goals_athlete_target_date_idx" ON "goals" USING btree ("athlete_id","target_date");--> statement-breakpoint
CREATE INDEX "recommendations_athlete_created_at_idx" ON "recommendations" USING btree ("athlete_id","created_at");--> statement-breakpoint
CREATE INDEX "recommendations_check_in_id_idx" ON "recommendations" USING btree ("check_in_id");--> statement-breakpoint
CREATE INDEX "workouts_athlete_scheduled_date_idx" ON "workouts" USING btree ("athlete_id","scheduled_date");--> statement-breakpoint
CREATE INDEX "workouts_goal_id_idx" ON "workouts" USING btree ("goal_id");
--> statement-breakpoint
ALTER TABLE "athletes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "goals" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "workouts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "check_ins" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "recommendations" ENABLE ROW LEVEL SECURITY;
