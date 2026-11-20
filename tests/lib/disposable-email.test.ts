import { describe, expect, it } from "vitest";
import { DISPOSABLE_EMAIL_DOMAINS } from "@/lib/disposable-email-domains.generated";
import { isDisposableEmail, parseBlocklist, renderDomainsModule } from "@/lib/disposable-email";

describe("isDisposableEmail", () => {
  it("blocks a listed domain, whatever the case", () => {
    expect(isDisposableEmail("ada@mailinator.com")).toBe(true);
    expect(isDisposableEmail("Ada@MAILINATOR.com")).toBe(true);
  });

  it("blocks a subdomain of a listed domain", () => {
    expect(isDisposableEmail("ada@inbox.mailinator.com")).toBe(true);
  });

  it("allows ordinary providers and look-alike suffixes", () => {
    expect(isDisposableEmail("ada@gmail.com")).toBe(false);
    expect(isDisposableEmail("ada@example.com")).toBe(false);
    expect(isDisposableEmail("ada@xmailinator.test")).toBe(false);
  });

  it("is false for something with no domain", () => {
    expect(isDisposableEmail("ada")).toBe(false);
    expect(isDisposableEmail("ada@")).toBe(false);
  });

  it("ships a list of real size", () => {
    expect(DISPOSABLE_EMAIL_DOMAINS.length).toBeGreaterThan(5000);
  });
});

describe("blocklist file helpers", () => {
  it("parses comments, blanks, case and duplicates", () => {
    expect(parseBlocklist("B.example\r\n# note\n\na.example # trailing\nb.example\n")).toEqual(["a.example", "b.example"]);
  });

  it("renders a module that names its source", () => {
    const out = renderDomainsModule(["a.example"], "https://source.test/list", "2026-11-20");
    expect(out).toContain('["a.example"]');
    expect(out).toContain("https://source.test/list");
  });
});
