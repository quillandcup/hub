import { describe, expect, it } from "vitest";
import { classifyCode } from "@/lib/sign-in-code";

const TOKEN = "x".repeat(43);

describe("classifyCode", () => {
  it.each([
    ["12345678", "12345678"],
    ["123456", "123456"],
    [" 1234 5678 ", "12345678"],
    ["1234-5678", "12345678"],
  ])("takes %j for an email code", (input, code) => {
    expect(classifyCode(input)).toEqual({ kind: "email_code", code });
  });

  it("takes Slack's code however it is written, and finds it inside a copied message", () => {
    expect(classifyCode("abcde-12345")).toEqual({ kind: "slack_code", code: "ABCDE12345" });
    expect(classifyCode("ABCDE 12345")).toEqual({ kind: "slack_code", code: "ABCDE12345" });
    expect(classifyCode("Or enter this code on the sign-in page: `ABCDE-12345`")).toEqual({ kind: "slack_code", code: "ABCDE12345" });
  });

  it("takes only the token from a Slack link, whatever host it is on", () => {
    expect(classifyCode(`https://evil.example/auth/slack?token=${TOKEN}`)).toEqual({ kind: "slack_link", token: TOKEN });
  });

  it("does not mistake an email code for a Slack one or the other way round", () => {
    expect(classifyCode("12345678")?.kind).toBe("email_code");
    expect(classifyCode("1234567890")?.kind).toBe("slack_code");
  });

  it.each(["", "hello", "12345", "123456789", "shopping list"])("takes %j for nothing", (input) => {
    expect(classifyCode(input)).toBeNull();
  });
});
