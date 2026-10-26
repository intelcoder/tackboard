/** Saves and restores the whole project folder. A checkpoint id is a git commit sha. */
export interface CheckpointStore {
  snapshot(label: string): string;
  restore(id: string): void;
  changedFiles(fromId: string, toId: string): string[];
  hasChangedSince(id: string): boolean;
}
