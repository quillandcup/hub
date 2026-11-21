import {
  extractSlackSignInCredential,
  type SlackSignInCredential,
} from "@/lib/slack-sign-in-code";

/**
 * What a member typed or pasted into the sign-in page's single code box: the code from the sign-in
 * email (6 to 8 digits), or either kind of credential from Slack (the one-time link, or its
 * `ABCDE-12345` code). The shapes don't overlap: a Slack code is 10 characters, an email code at
 * most 8 digits. Client-safe; the server checks each kind itself.
 */
export type TypedCode =
  | { kind: "email_code"; code: string }
  | { kind: "slack_code"; code: string }
  | { kind: "slack_link"; token: string };

export function classifyCode(text: string): TypedCode | null {
  const slack: SlackSignInCredential | null = extractSlackSignInCredential(text);
  if (slack) return slack.kind === "token" ? { kind: "slack_link", token: slack.token } : { kind: "slack_code", code: slack.code };

  const digits = text.replace(/[\s-]/g, "");
  if (/^\d{6,8}$/.test(digits)) return { kind: "email_code", code: digits };
  return null;
}
