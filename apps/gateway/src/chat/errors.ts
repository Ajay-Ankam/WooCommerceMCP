export type LlmErrorKind =
  | "rate_limit"
  | "timeout"
  | "unavailable"
  | "auth"
  | "bad_request"
  | "provider_error"
  | "invalid_response";

// Every kind triggers fallback to the next provider: for the demo it is
// better to try another model than to fail on one provider's quirk.
export class LlmError extends Error {
  constructor(
    readonly kind: LlmErrorKind,
    readonly provider: string,
    message: string,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

const KIND_BY_STATUS: Array<[test: (status: number) => boolean, kind: LlmErrorKind]> = [
  [(s) => s === 429, "rate_limit"],
  [(s) => s === 401 || s === 403, "auth"],
  [(s) => s === 404, "unavailable"],
  [(s) => s === 408 || s === 504, "timeout"],
  [(s) => s >= 500, "provider_error"],
  [(s) => s >= 400, "bad_request"],
];

// Provider error bodies are summarised, never echoed whole: they can be long
// and must not leak request details into logs or the browser.
export function errorFromResponse(provider: string, status: number, body: string): LlmError {
  const kind = KIND_BY_STATUS.find(([test]) => test(status))?.[1] ?? "provider_error";
  let detail = "";

  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    detail = parsed.error?.message ?? "";
  } catch {
    // Non-JSON body: keep the status only.
  }

  // Account identifiers in provider messages are not for the browser.
  const safe = detail.replace(/\borg_[A-Za-z0-9]+/g, "org_[redacted]").slice(0, 200);

  return new LlmError(kind, provider, `HTTP ${status}${safe ? `: ${safe}` : ""}`);
}

export async function postJson(
  provider: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  let response: Response;

  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new LlmError("timeout", provider, `No response within ${timeoutMs}ms`);
    }

    throw new LlmError("provider_error", provider, "Provider unreachable");
  }

  const text = await response.text();

  if (!response.ok) {
    throw errorFromResponse(provider, response.status, text);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new LlmError("invalid_response", provider, "Provider returned invalid JSON");
  }
}
