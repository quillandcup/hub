/**
 * How a member just signed in, as the browser sees it (the server half is lib/signin-method.ts,
 * which holds the explanation). Kept free of server-only imports so client components can use it.
 */

export const SIGNIN_METHOD_COOKIE = "hub_signin_method";
export const SIGNIN_METHOD_MAX_AGE_SECONDS = 5 * 60;

export const SIGNIN_METHODS = ["email_link", "email_code", "slack_link", "slack_continue", "slack_code"] as const;
export type SignInMethod = (typeof SIGNIN_METHODS)[number];

export function isSignInMethod(value: unknown): value is SignInMethod {
  return typeof value === "string" && (SIGNIN_METHODS as readonly string[]).includes(value);
}

/** Browser: the method in a `document.cookie` string, or null (missing or not one of ours). */
export function readSignInMethod(cookieString: string): SignInMethod | null {
  for (const part of cookieString.split(";")) {
    const [name, value] = part.trim().split("=");
    if (name === SIGNIN_METHOD_COOKIE) return isSignInMethod(value) ? value : null;
  }
  return null;
}

/** Browser: remove the cookie once it has been read. */
export function clearSignInMethod(): void {
  document.cookie = `${SIGNIN_METHOD_COOKIE}=; path=/; max-age=0`;
}
