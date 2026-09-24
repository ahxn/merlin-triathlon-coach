# Intervals Integrated Coach

A personal, athlete-controlled triathlon training companion that combines planned workouts, subjective check-ins, and explainable recommendations.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run generate` — generate a SQL migration after schema changes
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Local API setup: copy `.env.example` to `.env`, then replace the password placeholder in `DATABASE_URL` using the Session pooler connection string from the project's Connect dialog. Keep the database password private; `.env` is git-ignored.
- The API binds to `127.0.0.1` by default. Set `HOST` explicitly when running in a hosted environment.
- The Supabase `public` tables have RLS enabled and no client policies. Access them only through the local Express API until authentication and per-athlete policies are implemented.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/triathlon-coach` — React client
- `artifacts/api-server` — Express API
- `lib/db/src/schema/index.ts` — source of truth for the PostgreSQL domain model
- `lib/api-spec/openapi.yaml` — source of truth for the HTTP contract
- `lib/db/drizzle` — generated SQL migrations

## Architecture decisions

- All training records carry an athlete ID. The first release can use one configured athlete without baking single-user assumptions into storage.
- Recommendations are proposals with explicit status; they never silently mutate workouts.
- Imported workouts use a source/id pair for idempotent synchronization.
- Subjective check-ins are limited to one per athlete per calendar day.

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
