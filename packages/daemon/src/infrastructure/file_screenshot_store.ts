import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brand } from "@app/shared";
import type { ScreenshotStore } from "../domain/repositories.ts";

export class FileScreenshotStore implements ScreenshotStore {
  private projectDir: string;
  constructor(projectDir: string) {
    this.projectDir = projectDir;
  }

  save(threadId: string, png: Buffer): string {
    const relative = `${brand.dataDir}/shots/${threadId}.png`;
    mkdirSync(join(this.projectDir, brand.dataDir, "shots"), { recursive: true });
    writeFileSync(join(this.projectDir, relative), png);
    return relative;
  }
}
