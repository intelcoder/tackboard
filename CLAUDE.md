# Tackboard: working rules

- **Memoized panel render.** `draw()` in `packages/overlay/src/panel.ts` skips work when its `look` signature is unchanged. When you add UI state, add it to `look`, test it by clicking in the real panel (e2e), and confirm the test fails on the broken code before trusting it.
- **Patterns on user text.** Any regex that runs on page or user text (redaction, parsing) gets a large-input speed test in the same change (see `packages/shared/test/redact.test.ts`). Anchor with lookbehind and cap the input length.
- **No required install steps.** Features must work from what the dev server already exposes (script tag or extension). A Vite plugin may add detail but never be needed. Read framework data from the page; do not ask users to change their config.
- **Verification evidence is not tracked.** `specs/*/evidence/` is gitignored; keep it on disk only.
