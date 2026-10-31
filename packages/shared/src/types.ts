export type ThreadStatus = "pending" | "received" | "waiting" | "resolved";
export type Confidence = "source" | "component" | "text";

export type PageError = { kind: "error" | "warn" | "network"; text: string };

export type ElementRef = {
  selector: string;
  tag: string;
  text: string;
  html: string;
  rect: { x: number; y: number; w: number; h: number };
  component?: string[];
  source?: string;
  /** Path of the screenshot file, from the project folder. Only the daemon sets it. */
  screenshot?: string;
  /** Console errors, warnings and failed requests of the page, when the user attached them. */
  pageErrors?: PageError[];
  confidence: Confidence;
};

export type MessageDto = {
  id: string;
  author: string;
  text: string;
  at: number;
  discarded: boolean;
  checkpointId?: string;
  ask?: boolean;
};

export type ThreadDto = {
  id: string;
  n: number;
  branch: string;
  commit: string;
  url: string;
  viewport: { w: number; h: number };
  element: ElementRef;
  status: ThreadStatus;
  agent?: string;
  openedBy: "user" | "agent";
  unread: boolean;
  discarded: boolean;
  claimedAt?: number;
  claimStale: boolean;
  messages: MessageDto[];
};

export type ListThreadsResponse = {
  branch: string;
  threads: ThreadDto[];
  history: ThreadDto[];
  agent: { name: string | null; online: boolean };
  restoreBlocked: string | null;
};

export type RestoreResult = {
  restoredTo: string;
  discardedMessageIds: string[];
  discardedThreadIds: string[];
  changedFiles: string[];
  safetyCheckpointId: string;
};

export type Notice = {
  id: string;
  at: number;
  restoredToMessage: string;
  files: string[];
  discardedThreads: string[];
};

export type HistoryEventType =
  | "posted"
  | "claimed"
  | "replied"
  | "resolved"
  | "reopened"
  | "released"
  | "requeued"
  | "restored";

export type HistoryEvent = {
  seq: number;
  threadId: string | null;
  type: HistoryEventType;
  at: number;
  data: unknown;
};

export type ErrorCode =
  | "invalid"
  | "unauthorized"
  | "forbidden_host"
  | "forbidden_origin"
  | "not_found"
  | "not_pending"
  | "waiting_on_user"
  | "restore_blocked"
  | "wrong_branch"
  | "no_git"
  | "too_large"
  | "internal";

export type ApiErrorBody = { error: ErrorCode; message: string };

export type ProjectConfig = {
  port: number;
  token: string;
  origins: string[];
  userName: string;
};
