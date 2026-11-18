import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { COMPLIANCE_GROUPS, COMPLIANCE_PROVIDERS } from "@/lib/compliance";
import { SECURITY_GROUPS } from "@/lib/security";
import { PRIVACY_SECTIONS, privacyMemberText } from "@/lib/privacy";
import { PRIVACY_GROUPS } from "@/lib/privacy-promises";

/**
 * The public trust pages describe providers by what they do ("our payment provider"), never by name. The names
 * live on the staff pages (`/admin/compliance`, `/admin/security`, `/admin/privacy`) and in evidence paths. That
 * covers the Privacy page too: its member-facing content (`lib/privacy.ts`, and the "Share usage statistics"
 * switch) is checked here; the staff rows of `lib/privacy-promises.ts` may keep the names.
 */
const PROVIDER_NAMES = /\b(Stripe|Supabase|Vercel|Sentry|Mux|Slack|Zoom|Kajabi|Resend|Gravatar|Checkly|Dependabot|GitHub|Google|Twilio|Cloudflare|AWS|Amazon)\b/;

function memberText(): string[] {
  const out: string[] = [];
  for (const group of COMPLIANCE_GROUPS) {
    out.push(group.title, group.intro);
    for (const item of group.items) out.push(item.name, item.about, item.detail);
  }
  for (const provider of COMPLIANCE_PROVIDERS) out.push(provider.role, provider.covers);
  for (const group of SECURITY_GROUPS) {
    out.push(group.title, group.intro);
    for (const item of group.items) out.push(item.title, item.member);
  }
  return out;
}

describe("public trust pages name no provider", () => {
  it("reads the text members see on /compliance and /security", () => {
    expect(memberText().length).toBeGreaterThan(40);
    for (const text of memberText()) expect(text, `"${text.slice(0, 60)}..." names a provider`).not.toMatch(PROVIDER_NAMES);
  });

  it("keeps the provider names on the staff side", () => {
    expect(COMPLIANCE_PROVIDERS.some((p) => /Stripe/.test(p.name))).toBe(true);
    const staff = JSON.stringify(SECURITY_GROUPS.flatMap((g) => g.items.map((i) => i.staff)));
    expect(staff).toMatch(/Supabase/);
  });

  it("reads the text members see on /privacy, and the switch beside it", () => {
    const text = privacyMemberText();
    expect(text.length).toBeGreaterThan(100);
    for (const t of text) expect(t, `"${t.slice(0, 60)}..." names a provider`).not.toMatch(PROVIDER_NAMES);
    const switchSource = readFileSync("app/privacy/StatsOptOutSwitch.tsx", "utf8");
    expect(switchSource).not.toMatch(PROVIDER_NAMES);
  });

  it("checks every section of the Privacy page, and keeps the names on its staff side", () => {
    expect(PRIVACY_SECTIONS.length).toBeGreaterThanOrEqual(8);
    const staff = JSON.stringify(PRIVACY_GROUPS.flatMap((g) => g.rows.flatMap((r) => [r.how, r.open])));
    expect(staff).toMatch(/Slack/);
    expect(staff).toMatch(/Gravatar/);
  });
});
