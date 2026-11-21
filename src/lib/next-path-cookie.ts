import { cookies } from "next/headers";
import { NEXT_PATH_COOKIE, NEXT_PATH_COOKIE_MAX_AGE_SECONDS, safeNextPath } from "@/lib/safe-next";

/**
 * Read and clear the page the proxy remembered before sending the visitor to /login, for route
 * handlers and server actions that just signed someone in. Always a safe same-origin path.
 */
export async function takeNextPath(fallback = "/"): Promise<string> {
  const store = await cookies();
  const raw = store.get(NEXT_PATH_COOKIE)?.value;
  if (raw !== undefined) store.delete(NEXT_PATH_COOKIE);
  return safeNextPath(raw) ?? fallback;
}

/**
 * Remember where a visitor is headed across a hop that leaves the site and comes back (Slack's approval page): the same cookie the proxy
 * sets for sign-in, same attributes. For route handlers and server actions only (Server Components can't set cookies). A value that
 * isn't a safe same-origin path is ignored, so nothing unvalidated is ever stored.
 */
export async function storeNextPath(path: string | null | undefined): Promise<void> {
  const next = safeNextPath(path);
  if (!next) return;
  (await cookies()).set(NEXT_PATH_COOKIE, next, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: NEXT_PATH_COOKIE_MAX_AGE_SECONDS,
  });
}

/** Forget the remembered destination (the visitor gave up, or the hop failed), so a later sign-in doesn't send them somewhere they stopped wanting to go. */
export async function clearNextPath(): Promise<void> {
  (await cookies()).delete(NEXT_PATH_COOKIE);
}
