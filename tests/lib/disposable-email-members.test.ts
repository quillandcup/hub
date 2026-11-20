import { describe, it, expect } from "vitest";
import { findMembersWithDisposableEmail, type DisposableEmailMember } from "@/lib/disposable-email-members";

const member = (id: string, name: string, email: string, status = "active"): DisposableEmailMember => ({ id, name, displayName: null, email, status });

describe("findMembersWithDisposableEmail", () => {
  it("matches a primary email, whatever its case", () => {
    const result = findMembersWithDisposableEmail([member("m1", "Ada Example", "Ada@MAILINATOR.com")], []);
    expect(result).toEqual([
      { memberId: "m1", name: "Ada Example", displayName: null, addresses: [{ email: "Ada@MAILINATOR.com", kind: "primary" }] },
    ]);
  });

  it("matches an alias through the member's canonical email, case-insensitively", () => {
    const result = findMembersWithDisposableEmail(
      [member("m1", "Ada Example", "ada@example.com")],
      [
        { alias_email: "x@mailinator.com", canonical_email: "ADA@example.com" },
        { alias_email: "fine@example.org", canonical_email: "ada@example.com" },
        { alias_email: "y@mailinator.com", canonical_email: "other@example.com" },
      ],
    );
    expect(result).toHaveLength(1);
    expect(result[0].addresses).toEqual([{ email: "x@mailinator.com", kind: "alias" }]);
  });

  it("lists the primary before its aliases when both match", () => {
    const result = findMembersWithDisposableEmail(
      [member("m1", "Ada Example", "a@mailinator.com")],
      [{ alias_email: "b@mailinator.com", canonical_email: "a@mailinator.com" }],
    );
    expect(result[0].addresses.map((a) => a.kind)).toEqual(["primary", "alias"]);
  });

  it("matches a subdomain of a listed domain", () => {
    expect(findMembersWithDisposableEmail([member("m1", "Ada Example", "ada@box.mailinator.com")], [])).toHaveLength(1);
  });

  it("returns nothing when no address matches, and skips members who are not active", () => {
    const result = findMembersWithDisposableEmail(
      [member("m1", "Ada Example", "ada@example.com"), member("m2", "Bea Example", "bea@mailinator.com", "inactive")],
      [{ alias_email: "ada2@example.org", canonical_email: "ada@example.com" }],
    );
    expect(result).toEqual([]);
  });

  it("sorts by name and handles more than 1000 members and aliases", () => {
    const members = Array.from({ length: 1200 }, (_, i) => member(`m${i}`, `Member ${String(i).padStart(4, "0")}`, `m${i}@example.com`));
    const aliases = members.map((m, i) => ({ alias_email: `a${i}@${i % 2 === 0 ? "mailinator.com" : "example.org"}`, canonical_email: m.email }));
    const result = findMembersWithDisposableEmail([...members].reverse(), aliases);
    expect(result).toHaveLength(600);
    expect(result[0].name).toBe("Member 0000");
    expect(result[599].name).toBe("Member 1198");
  });
});
