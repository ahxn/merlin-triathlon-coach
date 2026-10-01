# Merlin alpha account setup

Merlin now uses Supabase Auth for email/password accounts. Passwords are never stored in the Merlin application tables. Each account receives its own athlete profile; pre-existing sample data stays unassigned. Intervals.icu API keys are encrypted with AES-256-GCM before they are stored and are only decrypted by the API server when that same account syncs. An Intervals.icu connection is required to use Merlin’s training-data features.

## Local setup

Copy `.env.example` to `.env` if you do not already have a local environment file. Set the Supabase project URL and publishable key in `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_PUBLISHABLE_KEY`. The browser key is a publishable key; never put a secret/service-role key in a `VITE_` variable. Set `INTERVALS_CREDENTIAL_ENCRYPTION_KEY` to 32 random bytes encoded as hex (`openssl rand -hex 32`). Keep that server-only key stable and backed up: changing it makes previously saved Intervals.icu keys unreadable.

Apply the checked-in SQL migrations in order. The historical `0005_garmin_credentials.sql` is followed by `0006_remove_garmin_credentials.sql`, which safely removes its table. Restart the API and Vite development servers after changing environment variables.

## Supabase Auth settings

In Supabase Dashboard → Authentication → URL Configuration, set the site URL to the deployed Merlin origin and add the local and deployed `/login` and `/reset-password` redirect URLs. Enable email/password sign-in. Email confirmation is supported by the signup flow; configure SMTP before inviting a broader alpha group so confirmation and password recovery messages arrive reliably.

## Deploying a shareable alpha

Deploy the web artifact and API server to reachable HTTPS origins. The Replit artifact config already supplies the public Supabase URL/key to the web build and points requests to `/api`. In the API service’s deployment secrets, set `DATABASE_URL` and `INTERVALS_CREDENTIAL_ENCRYPTION_KEY`; the Supabase URL and publishable key are supplied in the artifact config. If deploying elsewhere, set the same web build variables and point `VITE_API_URL` at the API’s public `/api` base URL. Do not use the local generated encryption key in production; generate and back it up as a deployment secret. Add the deployed origin to Supabase's Auth redirect allow-list.

When the app is publicly reachable, share its root URL. Visitors can create their own accounts and profiles. Each athlete must connect their own Intervals.icu account to use training-data features.
