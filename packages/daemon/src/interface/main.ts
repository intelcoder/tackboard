import { resolve } from "node:path";
import { brand, readConfig } from "@app/shared";
import type { Clock } from "../domain/repositories.ts";
import { SystemClock } from "../infrastructure/clock.ts";
import { createDaemon } from "./http.ts";

const projectDir = resolve(process.argv[2] ?? process.cwd());
const config = readConfig(projectDir);

// Tests move the clock forward to make claims go stale. Real runs never do.
const offset_minutes = process.env.NODE_ENV === "test" ? Number(process.env[`${brand.envPrefix}CLOCK_OFFSET_MIN`] ?? 0) : 0;
const system = new SystemClock();
const clock: Clock = { now: () => system.now() + (Number.isFinite(offset_minutes) ? offset_minutes : 0) * 60_000 };

const daemon = createDaemon({
  projectDir,
  port: config.port,
  allowedOrigins: config.origins,
  token: config.token,
  clock,
});

const port = await daemon.listen();
console.log(`listening 127.0.0.1:${port}`);

const stop = () => {
  daemon.close().then(() => process.exit(0));
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
