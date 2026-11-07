import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import { buildTemplates } from "../../scripts/_email-templates";

const SUBJECT = "{{ .Token }} is your Hedgie Hub verification code";

describe("sign-in code email (Gmail 'Copy code')", () => {
  it("leads the subject with the code, in the template list and in config.toml", async () => {
    const magic = (await buildTemplates()).find((t) => t.name === "magic_link")!;
    expect(magic.subject).toBe(SUBJECT);
    const config = readFileSync(resolve(__dirname, "../../supabase/config.toml"), "utf8");
    expect(config).toContain(`subject = "${SUBJECT}"`);
  });

  it("shows the code alone in a large element, with the standard wording near it", async () => {
    const magic = (await buildTemplates()).find((t) => t.name === "magic_link")!;
    expect(magic.html).toMatch(/font-size:36px[^"]*">\{\{ \.Token \}\}<\/p>/);
    expect(magic.html).toContain("verification code");
    expect(magic.html).toContain("Your code is:");
  });

  it("keeps the committed supabase/templates/magic_link.html in sync (run pnpm templates:render)", async () => {
    const magic = (await buildTemplates()).find((t) => t.name === "magic_link")!;
    const committed = readFileSync(resolve(__dirname, "../../supabase/templates/magic_link.html"), "utf8");
    expect(committed).toBe(magic.html);
  });
});
