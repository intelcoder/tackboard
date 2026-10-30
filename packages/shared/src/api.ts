import type {
  ElementRef,
  ErrorCode,
  HistoryEvent,
  Notice,
  ThreadDto,
} from "./types.ts";

export const LIMITS = {
  body: 2 * 1024 * 1024,
  text: 102400,
  html: 4096,
  elementText: 120,
  selector: 1000,
  /** Bytes of the PNG after decoding. Its base64 text still has to fit in `body`. */
  screenshot: 1_000_000,
} as const;

export const ERROR_STATUS: Record<ErrorCode, number> = {
  invalid: 400,
  unauthorized: 401,
  forbidden_host: 403,
  forbidden_origin: 403,
  not_found: 404,
  not_pending: 409,
  waiting_on_user: 409,
  restore_blocked: 409,
  wrong_branch: 409,
  no_git: 409,
  too_large: 413,
  internal: 500,
};

export const paths = {
  health: "/health",
  threads: "/threads",
  agentThread: "/threads/agent",
  claimNext: "/threads/claim-next",
  thread: (id: string) => `/threads/${encodeURIComponent(id)}`,
  messages: (id: string) => `/threads/${encodeURIComponent(id)}/messages`,
  resolve: (id: string) => `/threads/${encodeURIComponent(id)}/resolve`,
  reopen: (id: string) => `/threads/${encodeURIComponent(id)}/reopen`,
  release: (id: string) => `/threads/${encodeURIComponent(id)}/release`,
  read: (id: string) => `/threads/${encodeURIComponent(id)}/read`,
  restore: "/restore",
  notices: "/notices",
  ack: (name: string) => `/agents/${encodeURIComponent(name)}/ack`,
  history: "/history",
} as const;

export type PostThreadRequest = {
  element: ElementRef;
  url: string;
  viewport: { w: number; h: number };
  text: string;
  /** A PNG of the element, as base64 text. */
  screenshot?: string;
};
export type PostAgentThreadRequest = {
  agent: string;
  selector: string;
  text: string;
  url?: string;
};
export type ClaimNextRequest = { agent: string; branch?: string };
export type ClaimNextResponse = { thread: ThreadDto | null };
export type PostMessageRequest = { author: string; text: string; ask?: boolean };
export type ResolveRequest = { by: "user" | "agent"; agent?: string };
export type RestoreRequest = { threadId: string; messageId: string };
export type NoticesResponse = { notices: Notice[] };
export type HistoryResponse = { events: HistoryEvent[] };
export type OkResponse = { ok: true };
