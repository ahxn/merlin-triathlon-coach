REVOKE ALL ON TABLE public.athletes, public.goals, public.workouts, public.check_ins, public.recommendations, public.user_api_credentials FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
