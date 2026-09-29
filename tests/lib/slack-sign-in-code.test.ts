import { describe, it, expect } from "vitest";
import { extractSlackSignInCredential } from "@/lib/slack-sign-in-code";

const TOKEN = "a".repeat(20) + "B-_c" + "9".repeat(19); // 43 base64url chars

describe("extractSlackSignInCredential", () => {
  it("takes the token from a pasted sign-in link", () => {
    expect(extractSlackSignInCredential(`https://hub.quillandcup.com/auth/slack?token=${TOKEN}`)).toEqual({
      kind: "token",
      token: TOKEN,
    });
  });

  it("takes only the token from a link on another host (callers never navigate there)", () => {
    expect(extractSlackSignInCredential(`https://evil.example/auth/slack?token=${TOKEN}`)).toEqual({
      kind: "token",
      token: TOKEN,
    });
  });

  it("prefers the link when a whole Slack message is pasted", () => {
    const message = `Your one-time Hedgie Hub sign-in link (works once, until 3:45 PM):\nhttps://hub.quillandcup.com/auth/slack?token=${TOKEN}\n\nOr enter this code on the sign-in page: \`ABCDE-12345\``;
    expect(extractSlackSignInCredential(message)).toEqual({ kind: "token", token: TOKEN });
  });

  it.each([
    ["ABCDE-12345", "ABCDE12345"],
    ["abcde12345", "ABCDE12345"],
    [" abcde 12345 ", "ABCDE12345"],
    ["0O1IL-ABCDE", "00111ABCDE"],
  ])("reads a code typed or pasted as %j", (text, code) => {
    expect(extractSlackSignInCredential(text)).toEqual({ kind: "code", code });
  });

  it("finds a code inside surrounding text", () => {
    expect(extractSlackSignInCredential("Or enter this code on the sign-in page: `ABCDE-12345`")).toEqual({
      kind: "code",
      code: "ABCDE12345",
    });
  });

  it.each([
    "",
    "ABCDE",
    "ABCDE-1234",
    "I said hello there to them",
    "Codes look like abcde-12345 in Slack",
    `https://hub.quillandcup.com/auth/slack?token=short`,
  ])(
    "finds nothing in %j",
    (text) => {
      expect(extractSlackSignInCredential(text)).toBeNull();
    }
  );
});
