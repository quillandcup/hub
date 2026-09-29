import { cookies } from "next/headers";
import { NEXT_PATH_COOKIE, safeNextPath } from "@/lib/safe-next";

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
