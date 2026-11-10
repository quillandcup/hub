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

  it("keeps the committed supabase/templates/magic_link.html in sync (run pnpm templates:render)", async () => {
    const magic = (await buildTemplates()).find((t) => t.name === "magic_link")!;
    const committed = readFileSync(resolve(__dirname, "../../supabase/templates/magic_link.html"), "utf8");
    expect(committed).toBe(magic.html);
  });
});
