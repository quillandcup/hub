// Supabase Auth occasionally stalls without erroring; without a timeout, a
// call to auth.getUser() can hang until the platform's own limit kills the
// function (25s in middleware, longer but still eventually fatal in API
// routes) instead of failing fast into the existing "no session" path.
export const AUTH_CHECK_TIMEOUT_MS = 8000;

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

// Supabase's auth.getUser() call has no built-in timeout, so a slow or
// unresponsive Supabase Auth service otherwise hangs the caller indefinitely
// -- fatal in middleware, which Vercel kills at 25s regardless of what it's
// waiting on.
export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}
