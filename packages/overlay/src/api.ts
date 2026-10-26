import { paths, ERROR_STATUS } from "@app/shared";
import type {
  ApiErrorBody,
  ClaimNextRequest,
  ClaimNextResponse,
  ErrorCode,
  HistoryResponse,
  ListThreadsResponse,
  NoticesResponse,
  OkResponse,
  PostAgentThreadRequest,
  PostMessageRequest,
  PostThreadRequest,
  RestoreRequest,
  RestoreResult,
  ResolveRequest,
  ThreadDto,
} from "@app/shared";
import { brand } from "@app/shared";

/** Thrown for any non-2xx answer. Network failures are not wrapped: `fetch` rejects with its own error. */
export class ApiError extends Error {
  code: ErrorCode;
  status: number;
  constructor(code: ErrorCode, message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

export type ApiOptions = { base: string; token: string; fetch?: typeof fetch };

function codeForStatus(status: number): ErrorCode {
  const hit = (Object.entries(ERROR_STATUS) as [ErrorCode, number][]).find(([, s]) => s === status);
  return hit ? hit[0] : "internal";
}

export function createApi(options: ApiOptions) {
  const base = options.base.replace(/\/+$/, "");
  const fetchFn: typeof fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));

  async function call<T>(
    method: "GET" | "POST",
    path: string,
    query?: Record<string, string | undefined>,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) params.set(k, v);
    const qs = params.toString();
    const headers: Record<string, string> = { [brand.tokenHeader]: options.token };
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await fetchFn(base + path + (qs ? `?${qs}` : ""), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
    const raw = await res.text();
    let parsed: unknown;
    try {
      parsed = raw ? JSON.parse(raw) : undefined;
    } catch {
      parsed = undefined;
    }
    if (!res.ok) {
      const err = parsed as Partial<ApiErrorBody> | undefined;
      throw new ApiError(
        err?.error ?? codeForStatus(res.status),
        err?.message ?? `request failed with status ${res.status}`,
        res.status,
      );
    }
    return parsed as T;
  }

  return {
    health: () => call<OkResponse>("GET", paths.health),
    listThreads: (q: { branch?: string; state?: "open" | "resolved" } = {}) =>
      call<ListThreadsResponse>("GET", paths.threads, q),
    postThread: (b: PostThreadRequest, signal?: AbortSignal) => call<ThreadDto>("POST", paths.threads, undefined, b, signal),
    postAgentThread: (b: PostAgentThreadRequest) => call<ThreadDto>("POST", paths.agentThread, undefined, b),
    claimNext: (b: ClaimNextRequest) => call<ClaimNextResponse>("POST", paths.claimNext, undefined, b),
    postMessage: (id: string, b: PostMessageRequest, signal?: AbortSignal) =>
      call<ThreadDto>("POST", paths.messages(id), undefined, b, signal),
    resolve: (id: string, b: ResolveRequest) => call<ThreadDto>("POST", paths.resolve(id), undefined, b),
    reopen: (id: string) => call<ThreadDto>("POST", paths.reopen(id), undefined, {}),
    release: (id: string) => call<ThreadDto>("POST", paths.release(id), undefined, {}),
    markRead: (id: string) => call<ThreadDto>("POST", paths.read(id), undefined, {}),
    restore: (b: RestoreRequest) => call<RestoreResult>("POST", paths.restore, undefined, b),
    notices: (agent: string) => call<NoticesResponse>("GET", paths.notices, { agent }),
    ack: (name: string) => call<OkResponse>("POST", paths.ack(name), undefined, {}),
    history: (threadId?: string) => call<HistoryResponse>("GET", paths.history, { threadId }),
  };
}

export type Api = ReturnType<typeof createApi>;
