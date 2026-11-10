import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { CURRENT_PATH_HEADER, gateHref, type Gate } from "@/lib/gates";
import { safeNextPath } from "@/lib/safe-next";

/**
 * The address the visitor asked for, as the proxy saw it, or null (the proxy didn't run for this request, or the value isn't a safe
 * same-origin path). Server Components can read headers but not set cookies, so a gate that is decided while rendering passes this
 * along in the redirect (`?next=`) instead of storing it.
 */
export async function currentPath(): Promise<string | null> {
  return safeNextPath((await headers()).get(CURRENT_PATH_HEADER));
}

/** Sends the visitor to `gate`, with the page they asked for attached so the gate can bring them back to it. */
export async function redirectToGate(gate: Gate): Promise<never> {
  redirect(gateHref(gate, await currentPath()));
}
