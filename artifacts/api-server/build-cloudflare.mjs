import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const result = spawnSync(pnpm, ["--filter", "@workspace/triathlon-coach", "build"], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    BASE_PATH: "/",
    NODE_ENV: "production",
    PORT: "3000",
    VITE_API_URL: "/api",
  },
});

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
