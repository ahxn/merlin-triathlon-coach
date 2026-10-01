# Cloudflare deployment

Merlin's Cloudflare target serves the Vite app as Workers static assets and routes `/api/*` to an Express adapter. The API continues to use Supabase Auth and Postgres; Hyperdrive supplies the Postgres connection in production.

## Build and local preview

From the repository root:

```sh
pnpm --filter @workspace/api-server build:cloudflare
pnpm --filter @workspace/api-server cloudflare:dev
```

For local database access, set `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` to the Postgres URL already in `.env`. Wrangler local mode connects directly to Postgres; it does not exercise Hyperdrive's remote connection pooling or query cache. Put local Worker bindings in `artifacts/api-server/.dev.vars` and never commit that file.

The local-only `GET /__poc/db` route runs `SELECT 1`. It is enabled only by setting `CLOUDFLARE_POC_ENABLED=true` in the local `.dev.vars` file; do not add that setting to a deployed Worker.

## Cloudflare setup

1. Authenticate Wrangler with `pnpm dlx wrangler@4.143.1 login`.
2. Create a Hyperdrive configuration that connects to Merlin's Supabase Postgres database. Use the correct TLS-enabled connection URL, and keep the URL private.
3. Replace the all-zero `HYPERDRIVE.id` in `artifacts/api-server/wrangler.jsonc` with the Hyperdrive configuration ID.
4. Add these Worker secrets with `wrangler secret put`:
   - `SUPABASE_URL`
   - `SUPABASE_PUBLISHABLE_KEY`
   - `INTERVALS_CREDENTIAL_ENCRYPTION_KEY`
5. Deploy with `pnpm --filter @workspace/api-server cloudflare:deploy`.
6. Add the deployed `workers.dev` origin to Supabase Auth's allowed redirect URLs, then verify sign-up, sign-in, authenticated database reads/writes, and Intervals.icu sync.

The Worker sets a 10 ms CPU limit. CPU limits are enforced by Cloudflare's deployed runtime, not by local Wrangler mode.

## Training data connection

Intervals.icu is the required training-data integration. Merlin does not request or store users’ Garmin passwords.
