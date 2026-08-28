// Extracts the `session_id` claim from a Supabase Auth JWT access token
// without verifying the signature — this is intentionally not a
// verification step. Callers (lib/supabase/middleware.ts) only call this
// after supabase.auth.getUser() has already verified the same token over
// the network; this just reads a claim off it for tagging access_events
// rows, so a malformed/spoofed token here can at worst mistag a row (RLS
// still scopes everything by auth.uid(), not by this claim).
export function getSessionIdFromAccessToken(token: string): string | null {
  try {
    const payloadSegment = token.split(".")[1];
    if (!payloadSegment) return null;

    const base64 = payloadSegment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const json = atob(padded);
    const claims = JSON.parse(json);

    return typeof claims?.session_id === "string" ? claims.session_id : null;
  } catch {
    return null;
  }
}
