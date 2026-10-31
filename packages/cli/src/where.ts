import { existsSync } from "node:fs";
import { resolve } from "node:path";

/** The first of these paths (relative to this file; in the npm package, to the folder holding bin.js) that exists. The first is the checkout layout, the second the packaged one. */
export function firstExisting(checkout: string, packaged: string): string {
  const a = resolve(import.meta.dirname, checkout);
  return existsSync(a) ? a : resolve(import.meta.dirname, packaged);
}
