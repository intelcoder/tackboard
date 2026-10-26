import { after } from "node:test";
import { runApiContract } from "../../shared/test-support/api_contract.ts";
import { make_repo, remove, start_daemon } from "./daemon_setup.ts";

const folders: string[] = [];
after(() => {
  for (const f of folders) remove(f);
});

runApiContract("daemon", async () => {
  const dir = make_repo();
  folders.push(dir);
  const d = await start_daemon(dir);
  return { url: d.url, token: d.token, close: d.close };
});
