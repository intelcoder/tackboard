// THROWAWAY SPIKE CLI: node cli.mjs next | reply <id> <text> [--ask] | resolve <id>   (--as <name>)
const base = process.env.BOARD_URL || "http://127.0.0.1:4777";
const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i < 0 ? undefined : (args.splice(i, 2)[1]); };
const agent = flag("--as") || "agent";
const ask = args.includes("--ask") && args.splice(args.indexOf("--ask"), 1).length > 0;
const [cmd, id, ...rest] = args;
const post = (p, b) => fetch(base + p, { method: "POST", body: JSON.stringify(b) }).then((r) => r.json());

if (cmd === "next") {
  const t = await post("/next", { agent });
  if (!t) console.log("no pending threads on this branch");
  else console.log(`THREAD ${t.id}  branch: ${t.branch}\nPage: ${t.url}\nElement: ${t.element.selector}\n  text: ${t.element.text}\n  html: ${t.element.html}\nMessages:\n${t.messages.map((m) => `  ${m.from}: ${m.text}`).join("\n")}\n\nReply with: cli.mjs reply ${t.id} "..." [--ask]   then: cli.mjs resolve ${t.id}`);
} else if (cmd === "reply") console.log((await post("/reply", { id, text: rest.join(" "), from: agent, ask })).status);
else if (cmd === "resolve") console.log((await post("/resolve", { id })).status);
else console.log("usage: next | reply <id> <text> [--ask] | resolve <id>   [--as name]");
