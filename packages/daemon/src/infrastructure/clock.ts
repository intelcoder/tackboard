import type { Clock } from "../domain/repositories.ts";

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}
