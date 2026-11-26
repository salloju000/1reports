/// <reference types="vite/client" />

export function apiUrl(route: string, base = import.meta.env.BASE_URL) {
  return `${base}api/${route}`;
}

export async function apiRequest(route: string, options: RequestInit = {}) {
  const response = await fetch(apiUrl(route), {
    ...options,
    credentials: "same-origin",
    redirect: "error",
    cache: "no-store",
  });
  if (response.status === 401 && !route.startsWith("auth/")) {
    window.dispatchEvent(new Event("hub-unauthorized"));
  }
  return response;
}

export class ApiError extends Error {
  constructor(readonly status: number) {
    super(`Hub API returned HTTP ${status}.`);
  }
}

export async function csrfToken(signal: AbortSignal): Promise<string> {
  const response = await apiRequest("auth/csrf", { signal });
  if (!response.ok) throw new ApiError(response.status);
  const result = await response.json();
  if (typeof result?.token !== "string" || !result.token) {
    throw new Error("The Hub authentication API is unavailable.");
  }
  return result.token;
}

/** A request the server refused for a reason the person can fix: field messages, or one message for the form. */
export class FormError extends Error {
  constructor(readonly fields: Record<string, string>, message = "Check the highlighted fields.") {
    super(message);
  }
}

const timeout = () => AbortSignal.timeout(15000);

export async function readJson<T>(route: string): Promise<T> {
  const response = await apiRequest(route, { signal: timeout() });
  if (!response.ok) throw new ApiError(response.status);
  return response.json();
}

/** Sends JSON with the CSRF token; a 400 with field errors, or a 409/400 explanation, becomes a FormError. */
export async function sendJson<T>(route: string, method: string, body?: unknown): Promise<T> {
  const signal = timeout();
  const token = await csrfToken(signal);
  const response = await apiRequest(route, {
    method, signal,
    headers: { "X-CSRF-TOKEN": token, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.ok) return response.status === 204 ? (undefined as T) : response.json();
  const problem = await response.json().catch(() => null);
  if (response.status === 400 && problem?.errors && typeof problem.errors === "object") {
    const fields = Object.fromEntries(Object.entries(problem.errors as Record<string, unknown>)
      .map(([name, value]) => [name, Array.isArray(value) ? value.join(" ") : String(value)]));
    throw new FormError(fields);
  }
  if ((response.status === 409 || response.status === 400) && typeof problem?.detail === "string")
    throw new FormError({}, problem.detail);
  throw new ApiError(response.status);
}
