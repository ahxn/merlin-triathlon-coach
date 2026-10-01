// Cloudflare Workers entry point for the Merlin API and static app.
// App imports are deferred until a request arrives because the Node API and
// PostgreSQL driver initialize timers and other Node facilities at module load.
// @ts-ignore - Cloudflare virtual runtime module provided by Wrangler.
import { env } from "cloudflare:workers";
// @ts-ignore - Cloudflare virtual runtime module provided by Wrangler.
import { httpServerHandler } from "cloudflare:node";

type WorkerHandler = {
  fetch(request: Request, env: unknown, ctx: unknown): Promise<Response>;
};

let handlerPromise: Promise<WorkerHandler> | undefined;

function getApiHandler(): Promise<WorkerHandler> {
  handlerPromise ??= (async () => {
    const bindings = env as unknown as {
      HYPERDRIVE: { connectionString: string };
      SUPABASE_URL: string;
      SUPABASE_PUBLISHABLE_KEY: string;
      INTERVALS_CREDENTIAL_ENCRYPTION_KEY: string;
    };

    process.env.DATABASE_URL = bindings.HYPERDRIVE.connectionString;
    process.env.SUPABASE_URL = bindings.SUPABASE_URL;
    process.env.SUPABASE_PUBLISHABLE_KEY = bindings.SUPABASE_PUBLISHABLE_KEY;
    process.env.INTERVALS_CREDENTIAL_ENCRYPTION_KEY = bindings.INTERVALS_CREDENTIAL_ENCRYPTION_KEY;

    const { pool } = await import("@workspace/db");
    // Hyperdrive manages upstream connection pooling. Retire each pg client
    // after one checkout because Workers cannot reliably reuse this socket.
    pool.options.maxUses = 1;

    const { default: app } = await import("./worker-app");
    const port = 3000;
    app.listen(port);
    return httpServerHandler({ port }) as WorkerHandler;
  })();
  return handlerPromise;
}

export default {
  async fetch(request: Request, workerEnv: unknown, ctx: unknown): Promise<Response> {
    const handler = await getApiHandler();
    return handler.fetch(request, workerEnv, ctx);
  },
};
