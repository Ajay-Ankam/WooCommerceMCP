// Thin fetch wrapper for the gateway API. Same origin, so the HttpOnly session
// cookie is sent automatically; there is no token in JavaScript.

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  // Full error payload, e.g. the executed tool calls of a 503 LLM_UNAVAILABLE.
  readonly body: unknown;

  constructor(status: number, code: string, message: string, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;

// Answered by the ingress or proxy rather than the gateway (no JSON error body),
// typically while the gateway is restarting or not ready.
const UNAVAILABLE_STATUSES = new Set([502, 503, 504]);
const UNAVAILABLE_MESSAGE = "The gateway is temporarily unavailable. Please try again in a moment.";

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  const timeout = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

  let response: Response;

  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      // The gateway rejects every non-GET without a JSON content type (CSRF
      // defence), including body-less DELETEs, so it is always sent.
      headers: method === "GET" ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal,
    });
  } catch (error) {
    if (timeout.aborted) {
      throw new ApiError(0, "TIMEOUT", "The gateway took too long to respond");
    }

    if (options.signal?.aborted) {
      throw error;
    }

    throw new ApiError(0, "NETWORK_ERROR", "Cannot reach the gateway. Check your connection.");
  }

  const text = await response.text();
  let data: unknown = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const error = (data as { error?: { code?: string; message?: string } } | null)?.error;

    throw new ApiError(
      response.status,
      error?.code ?? `HTTP_${response.status}`,
      error?.message ?? (UNAVAILABLE_STATUSES.has(response.status) ? UNAVAILABLE_MESSAGE : `Request failed (${response.status})`),
      data,
    );
  }

  return data as T;
}

export function isApiError(error: unknown, status?: number): error is ApiError {
  return error instanceof ApiError && (status === undefined || error.status === status);
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError || error instanceof Error) {
    return error.message;
  }

  return "Something went wrong";
}

// Sign-in failures in plain language. The HTTP status stays on the ApiError
// for diagnostics; the gateway's 401 never says which field was wrong.
export function loginErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return "Sign-in failed unexpectedly. Please try again.";
  }

  if (error.status === 401) {
    return "Invalid email or password.";
  }

  if (error.status === 429) {
    return "Too many failed sign-in attempts. Wait a few minutes, then try again.";
  }

  if (error.code === "NETWORK_ERROR") {
    return "Cannot reach the gateway. Check your connection and try again.";
  }

  if (error.code === "TIMEOUT" || UNAVAILABLE_STATUSES.has(error.status)) {
    return UNAVAILABLE_MESSAGE;
  }

  return "Sign-in failed unexpectedly. Please try again.";
}

export function queryString(params: object): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  }

  const text = search.toString();
  return text ? `?${text}` : "";
}
