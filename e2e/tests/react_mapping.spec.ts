import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "../fixtures/harness.ts";
import { postComment } from "../fixtures/states.ts";

const button_line = () => {
  const lines = readFileSync(join(import.meta.dirname, "..", "fixtures", "react-site", "src", "PlanCard.tsx"), "utf8").split("\n");
  return lines.findIndex((line) => line.includes("<button")) + 1;
};

test.describe("with the source plugin", () => {
  test.use({ site: "react-plugin" });
  test("source attribute gives file and line", async ({ harness: h }) => {
    await postComment(h.page, "#choose-plan", "change this label");
    const next = await h.agent(["next"]);
    const line = button_line();
    expect(line).toBeGreaterThan(0);
    expect(next.stdout).toContain(`source: src/PlanCard.tsx:${line}`);
    expect(next.stdout).toContain("confidence: source");
  });
});

test.describe("without the source plugin", () => {
  test.use({ site: "react" });
  test("component names are found from React", async ({ harness: h }) => {
    await postComment(h.page, "#choose-plan", "change this label");
    const next = await h.agent(["next"]);
    expect(next.stdout).toContain("component: PricingPage > PlanCard");
    expect(next.stdout).toContain("confidence: component");
    expect(next.stdout).not.toContain("source:");
  });
});

test("plain html site has text confidence only", async ({ harness: h }) => {
  await postComment(h.page, "#cta", "change this label");
  const next = await h.agent(["next"]);
  expect(next.stdout).toContain("confidence: text");
  expect(next.stdout).not.toContain("component:");
  expect(next.stdout).not.toContain("source:");
});
