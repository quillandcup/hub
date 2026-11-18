import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import { buildTemplates } from "../../scripts/_email-templates";

const SUBJECT = "Hedgie Hub – {{ .Token }} is your verification code";

// These checks verify the template, not Gmail's decision to display its copy helper.
describe("sign-in code email", () => {
  it("includes the code in the subject, in the template list and in config.toml", async () => {
    const magic = (await buildTemplates()).find((t) => t.name === "magic_link")!;
    expect(magic.subject).toBe(SUBJECT);
    const config = readFileSync(resolve(__dirname, "../../supabase/config.toml"), "utf8");
    expect(config).toContain(`subject = "${SUBJECT}"`);
  });

  it("labels the code in the visible body and keeps its digits together", async () => {
    const magic = (await buildTemplates()).find((t) => t.name === "magic_link")!;
    expect(magic.html).toMatch(/font-size:36px[^"]*">\{\{ \.Token \}\}<\/p>/);
    expect(magic.html).toMatch(/<p[^>]*>Use the verification code below to sign in to Hedgie Hub\.<\/p>/);
  });

  it("points the sign-in, invitation and recovery links at /auth/confirm with the token hash, and not at Supabase's own address", async () => {
    const templates = await buildTemplates();
    const html = (name: string) => templates.find((t) => t.name === name)!.html;
    expect(html("magic_link")).toContain("{{ .RedirectTo }}?token_hash={{ .TokenHash }}&amp;type=email");
    expect(html("invite")).toContain("{{ .RedirectTo }}?token_hash={{ .TokenHash }}&amp;type=invite");
    expect(html("recovery")).toContain("{{ .RedirectTo }}?token_hash={{ .TokenHash }}&amp;type=recovery");
    for (const name of ["magic_link", "invite", "recovery"]) expect(html(name)).not.toContain("{{ .ConfirmationURL }}");
  });

  it("allows /auth/confirm as a redirect address in production and keeps /auth/callback for links already sent", () => {
    const config = readFileSync(resolve(__dirname, "../../supabase/config.toml"), "utf8");
    const prod = config.slice(config.indexOf("[remotes.prod.auth]"), config.indexOf("[remotes.prod.auth.email]"));
    expect(prod).toContain("/auth/confirm");
    expect(prod).toContain("/auth/callback");
  });

  it("keeps the committed supabase/templates/magic_link.html in sync (run pnpm templates:render)", async () => {
    const magic = (await buildTemplates()).find((t) => t.name === "magic_link")!;
    const committed = readFileSync(resolve(__dirname, "../../supabase/templates/magic_link.html"), "utf8");
    expect(committed).toBe(magic.html);
  });

  it("keeps the emails' one-hour promise in step with otp_expiry, and nothing says 24 hours", async () => {
    const config = readFileSync(resolve(__dirname, "../../supabase/config.toml"), "utf8");
    // otp_expiry is shared by the link, the typed code, invitations and recovery.
    expect(config).toMatch(/^otp_expiry = 3600$/m);
    const templates = await buildTemplates();
    const text = (name: string) => templates.find((t) => t.name === name)!.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(text("magic_link")).toContain("The link and the code work for one hour, and each works once.");
    expect(text("invite")).toContain("expires in one hour");
    expect(text("recovery")).toContain("good for one hour");
    for (const name of ["magic_link", "invite", "recovery"]) expect(text(name)).not.toMatch(/24 hours/i);
  });
});
