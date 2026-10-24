import { describe, expect, it } from "vitest";
import { emailPage, pushPage, slackMobilePage, slackPage } from "@/demo/mockups/frames";
import type { OutboundMessage } from "@/lib/channels/types";
import { notificationKind } from "@/lib/notifications/registry";

const message: OutboundMessage = { text: "Ready for Sprint Prickle in ~20 min?", url: "https://hub.example.test/my-prickles", title: "Check in" };

describe("slackPage", () => {
  it("draws the message as the Slack channel assembles it, from the bot's real name, in the theme asked for", () => {
    const light = slackPage(message, "light");
    expect(light).toContain("Billie Bot (Hedgie Hub)");
    expect(light).toContain("Ready for Sprint Prickle in ~20 min?");
    expect(light).toContain("Open in the Hub"); // the link a text-only message gets
    expect(light).toContain("data-frame");
    expect(light).toContain('class="light"');
    expect(slackPage(message, "dark")).toContain('class="dark"');
  });

  it("shows a message's own blocks and its footer links", () => {
    const html = slackPage(
      { ...message, slackBlocks: [{ type: "section", text: { type: "mrkdwn", text: "*Bold* body" } }], footerLinks: [{ label: "Notification settings", url: "https://hub.example.test/settings" }] },
      "light",
    );
    expect(html).toContain("Bold");
    expect(html).toContain("Notification settings");
  });
});

describe("slackMobilePage", () => {
  it("draws the same message on a phone-width screen, with the app's header and message box, in either theme", () => {
    const html = slackMobilePage(message, "dark");
    expect(html).toContain("Ready for Sprint Prickle in ~20 min?");
    expect(html).toContain("Open in the Hub");
    expect(html).toContain("width:390px");
    expect(html).toContain("Message Billie Bot (Hedgie Hub)"); // the message box
    expect(html).toContain('class="dark"');
    expect(slackMobilePage(message, "light")).toContain('class="light"');
  });

  it("shows a message's own blocks and its footer links, and lets a long message run past the nominal screen height", () => {
    const html = slackMobilePage(
      { ...message, slackBlocks: [{ type: "section", text: { type: "mrkdwn", text: "*Bold* body" } }], footerLinks: [{ label: "Notification settings", url: "https://hub.example.test/settings" }] },
      "light",
    );
    expect(html).toContain("Bold");
    expect(html).toContain("Notification settings");
    expect(html).toContain("min-height:760px");
    expect(html).not.toMatch(/[^-]height:760px/);
  });
});

describe("pushPage", () => {
  it("builds the payload the push channel would send: the kind's label as the title, the text as the body", () => {
    const html = pushPage(message, "prickle_checkin", "android", "light");
    expect(html).toContain("Check in"); // the message's own title wins
    expect(html).toContain("Ready for Sprint Prickle in ~20 min?");
    const untitled = pushPage({ text: "x" }, "prickle_checkin", "desktop", "light");
    expect(untitled).toContain(notificationKind("prickle_checkin").label);
  });

  it("labels each device, and the iPhone one says it needs the Hub on the Home Screen", () => {
    expect(pushPage(message, "prickle_checkin", "desktop", "light")).toContain("Browser notification on a computer");
    expect(pushPage(message, "prickle_checkin", "android", "dark")).toContain("Android phone");
    expect(pushPage(message, "prickle_checkin", "iphone", "light")).toContain("Home Screen");
  });

  it("escapes what a message says, so a name with markup can't break the frame", () => {
    const html = pushPage({ text: "<script>alert(1)</script> & more" }, "prickle_checkin", "desktop", "light");
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("emailPage", () => {
  it("wraps the real rendered email with its subject and sender, with the unsubscribe link a real send adds", async () => {
    const html = await emailPage("prickle_checkin", message);
    expect(html).toContain("Check in"); // the subject (title)
    expect(html).toContain("From");
    expect(html).toContain("<iframe");
    expect(html).toContain("Unsubscribe");
  });

  it("escapes a subject with markup", async () => {
    const html = await emailPage("prickle_checkin", { text: "<b>bold</b>" });
    expect(html).not.toContain("<h1><b>");
  });
});
