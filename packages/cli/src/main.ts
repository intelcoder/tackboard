#!/usr/bin/env node
import { run } from "./commands.ts";

process.exitCode = await run(process.argv.slice(2), process.cwd());
