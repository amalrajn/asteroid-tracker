export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const TIMEOUT_MS = 10_000;

export async function getJson<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
  } catch (err) {
    throw new ApiError(`request failed: ${String(err)}`, 0, true);
  }

  if (!res.ok) {
    const retryable = res.status === 429 || res.status >= 500;
    throw new ApiError(await res.text(), res.status, retryable);
  }

  return (await res.json()) as T;
}
