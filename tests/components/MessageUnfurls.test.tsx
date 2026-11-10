// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import MessageUnfurls from "@/components/chat/MessageUnfurls";
import type { ChatTextContext } from "@/components/chat/ChatText";
import { parseUnfurls } from "@/lib/chat/unfurls";
import { parseSharedMessage } from "@/lib/chat/shared-message";

const ctx: ChatTextContext = { userNames: { U1: "Fern <3 & Co" }, userMembers: {}, channelIds: {}, channelNames: {}, customEmoji: {} };
const PERMALINK = "https://example.slack.test/archives/C1/p1";
const draw = (raw: Parameters<typeof parseUnfurls>[0], opts = { bot: true, body: "" }) =>
  render(<MessageUnfurls unfurls={parseUnfurls(raw, opts).unfurls} ctx={ctx} permalink={PERMALINK} />);

describe("MessageUnfurls: link previews", () => {
  it("draws a link preview with safe links, decoded entities and a mention resolved to a name", () => {
    const { container } = draw(
      {
        attachments: [
          { title: "Fern &amp; Co &lt;3", title_link: "https://example.com/a", text: "Thanks <@U1> &amp; friends", service_name: "example.com", from_url: "https://example.com", image_url: "https://example.com/i.png", color: "ff0000", footer: "F &amp; G" },
        ],
      },
      { bot: false, body: "hi" }
    );
    const title = screen.getByRole("link", { name: "Fern & Co <3" });
    expect(title).toHaveAttribute("href", "https://example.com/a");
    expect(title).toHaveAttribute("target", "_blank");
    expect(title.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByText(/Thanks/)).toHaveTextContent("Thanks @Fern <3 & Co & friends");
    expect(screen.getByText("F & G")).toBeInTheDocument();
    const img = container.querySelector("img")!;
    expect(img).toHaveAttribute("src", "https://example.com/i.png");
    expect(img).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(screen.getByTestId("unfurl-card").getAttribute("style")).toContain("border-left-color: rgb(255, 0, 0)");
  });

  it("never makes a link or a picture of an unsafe address", () => {
    const { container } = draw({ attachments: [{ title: "Hostile", title_link: "javascript:alert(1)", image_url: "javascript:alert(1)", thumb_url: "http://insecure.example/x.png" }] });
    expect(screen.getByText("Hostile").closest("a")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('a[href^="javascript"]')).toBeNull();
  });
});

describe("MessageUnfurls: Block Kit", () => {
  const blocks = [
    { type: "header", text: { type: "plain_text", text: "Deploy <ready> *now*" } },
    { type: "section", text: { type: "mrkdwn", text: "*main* is live &amp; healthy" }, fields: [{ type: "mrkdwn", text: "Env prod" }] },
    { type: "context", elements: [{ type: "mrkdwn", text: "by <@U1>" }] },
    { type: "divider" },
    { type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "Logs" }, url: "https://example.com/logs" }, { type: "button", text: { type: "plain_text", text: "Approve" }, action_id: "x" }] },
    { type: "video", title: { type: "plain_text", text: "v" } },
  ];

  it("draws the supported blocks, plain text as it is, and only link buttons", () => {
    draw({ blocks });
    expect(screen.getByRole("heading", { name: "Deploy <ready> *now*" })).toBeInTheDocument();
    expect(screen.getByText("main", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText(/is live & healthy/)).toBeInTheDocument();
    expect(screen.getByText("@Fern <3 & Co")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Logs" })).toHaveAttribute("href", "https://example.com/logs");
    expect(screen.queryByText("Approve")).toBeNull();
    expect(screen.getByTestId("unfurl-blocks")).toBeInTheDocument();
  });

  it("offers Open in Slack for a block it cannot draw", () => {
    draw({ blocks });
    expect(screen.getByRole("link", { name: "Open in Slack" })).toHaveAttribute("href", PERMALINK);
  });

  it("says so without a link when there is no Slack address", () => {
    render(<MessageUnfurls unfurls={parseUnfurls({ blocks }, { bot: true, body: "" }).unfurls} ctx={ctx} permalink={null} />);
    expect(screen.queryByRole("link", { name: "Open in Slack" })).toBeNull();
    expect(screen.getByText(/can only be seen in Slack/)).toBeInTheDocument();
  });
});

describe("MessageUnfurls: shared messages", () => {
  const raw = { attachments: [{ is_msg_unfurl: true, text: "quoted" }] };
  it("draws nothing for a share the loader has not resolved", () => {
    const { container } = draw(raw);
    expect(container).toHaveTextContent("");
  });
  it("draws the quoted-message card, or a stub, from what the loader resolved", () => {
    const unfurls = parseUnfurls(raw, { bot: false, body: "" }).unfurls.map((u) =>
      u.kind === "share"
        ? { ...u, shared: parseSharedMessage(u.attachment)!, source: { kind: "private" as const } }
        : u
    );
    render(<MessageUnfurls unfurls={unfurls} ctx={ctx} permalink={null} />);
    expect(screen.getByTestId("shared-message-stub")).toBeInTheDocument();
    expect(screen.queryByText("quoted")).toBeNull();
  });
  it("renders nothing for no unfurls", () => {
    const { container } = render(<MessageUnfurls unfurls={[]} ctx={ctx} permalink={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
