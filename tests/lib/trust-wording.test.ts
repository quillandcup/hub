import { describe, it, expect } from "vitest";
import { privacyMemberText } from "@/lib/privacy";
import { COMPLIANCE_GROUPS, COMPLIANCE_STATUSES } from "@/lib/compliance";
import { SECURITY_ITEMS } from "@/lib/security";

/**
 * Wording on the Privacy, Compliance and Security pages that was checked against the code and the production flags
 * on 2026-11-18, after a member reader review. Each assertion is a claim that must stay true or stay out.
 */
describe("privacy page wording", () => {
  const text = privacyMemberText().join("\n");

  it("no longer describes the Slack DM bridge as rolling out or switched on for only some members", () => {
    // The flag has been on for everyone since 2026-11-13 (read from production), so a conditional would be false.
    expect(text).not.toMatch(/roll it out/);
    expect(text).not.toMatch(/switched on for/);
    expect(text).toMatch(/The Hub brings your one-on-one Slack DMs into Hub Chat and keeps them/);
  });

  it("calls break-glass access emergency access for members, and says it is rare and recorded", () => {
    expect(text).not.toMatch(/break-glass/i);
    expect(text).toMatch(/rare, recorded emergency access/);
  });

  it("says who cannot read plan messages without the word assistants", () => {
    expect(text).not.toMatch(/assistants/);
    expect(text).toMatch(/other team members cannot/);
  });

  it("says engagement means taking part", () => {
    expect(text).toMatch(/engagement, meaning how much you take part/);
  });
});

describe("compliance page wording", () => {
  it("labels the not-applicable status in plain words", () => {
    expect(COMPLIANCE_STATUSES.notApplicable).toBe("Doesn't apply");
  });

  it("does not say nothing is recorded when a member declines: error recordings continue", () => {
    const gdpr = COMPLIANCE_GROUPS.flatMap((g) => g.items).find((i) => i.name === "GDPR and UK GDPR")!;
    expect(gdpr.detail).not.toMatch(/record nothing/);
    expect(gdpr.detail).toMatch(/error recordings/);
  });
});

describe("security page wording", () => {
  const member = (id: string) => SECURITY_ITEMS.find((i) => i.id === id)!.member;

  it("scopes the vault claim to the database, since a project's management token can decrypt it", () => {
    expect(member("vault")).toMatch(/Through the database, only the Hub's server can read it back/);
    expect(member("vault")).not.toMatch(/, and only the Hub's server can read it back/);
  });

  it("mentions the admin override of a failing check", () => {
    expect(member("changes")).toMatch(/an admin can merge a change past a failing check/);
  });
});
