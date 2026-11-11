import { appendFileSync, renameSync, statSync } from "node:fs";

export type Log = (kind: string, text: string) => void;

const MAX_BYTES = 1_000_000;

/** Appends one line per event to the file; the CLI's `logs` command reads it. A file over 1 MB is moved aside to `<file>.old` when the daemon starts. */
export function createLog(file: string): Log {
  try {
    if (statSync(file).size > MAX_BYTES) renameSync(file, `${file}.old`);
  } catch {
    // No file yet.
  }
  return (kind, text) => {
    try {
      appendFileSync(file, `${new Date().toTimeString().slice(0, 8)} ${kind.padEnd(8)} ${text}\n`);
    } catch {
      // A full disk must not break a request.
    }
  };
}
