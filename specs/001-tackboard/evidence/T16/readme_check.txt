T16 verifier README live check (temp git project, clone at scratchpad/verif16/repo, node v22.22.2)
OK: init output (3 lines, port/user), config.json fields, .git/info/exclude gets .tackboard/, git status clean,
    default origins 3000+5173 when no --origin, repeated --origin replaces defaults, --port/--user, bad port message,
    no-git warning text, "no tackboard project found here; run tackboard init", "cannot reach the daemon on port N; run tackboard start",
    start prints "listening 127.0.0.1:<port>", listens on 127.0.0.1 only (lsof), db at .tackboard/tackboard.db,
    next output identical to README sample, "no pending threads on this branch", reply --ask -> "waiting on you",
    resolve refused "thread 2 is waiting on the user" rc=1, user answer -> pending, comment --mention me, wait returns/timeouts rc 0,
    history shows claimed snapshot, restore via POST /restore -> files back, later threads discarded, NOTICE block repeats until ack,
    wrong_branch message, staged change reset, ignored file untouched.
MISMATCH: stale claim stays "received" in status after 31 min (claimStale flag only) until next agent claim requeues it; README says "goes back to pending after 30 minutes".
MISMATCH: security bullet "checks ... on every request": Origin checked only when an Origin header is present; request with token and no Origin -> 200; bundle request with Referer evil -> 200 (stated).
MISMATCH: "Snapshots are taken when the agent claims, replies to or resolves": reply/resolve snapshot only if files changed since the last one.
MINOR: "Node 22.22 or newer": only 22.22.2 run; no engines field.
