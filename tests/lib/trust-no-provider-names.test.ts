import { describe, it, expect } from "vitest";
import { COMPLIANCE_GROUPS, COMPLIANCE_PROVIDERS } from "@/lib/compliance";
import { SECURITY_GROUPS } from "@/lib/security";

/**
 * The public trust pages describe providers by what they do ("our payment provider"), never by name. The names
 * live on the staff pages (`/admin/compliance`, `/admin/security`) and in evidence paths. The Privacy page is
 * outside this guard: it names the services chat and billing run on, and that is a separate decision.
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
});
