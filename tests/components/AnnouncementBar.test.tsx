// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { renderToString } from "react-dom/server";
import AnnouncementBar from "@/components/announcements/AnnouncementBar";
import AnnouncementStack, { ANNOUNCEMENT_PRIORITY } from "@/components/announcements/AnnouncementStack";

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AnnouncementBar", () => {
  it.each([
    ["info", "bg-plum-50", "status"],
    ["notice", "bg-plum-600", "status"],
    ["critical", "bg-red-600", "alert"],
  ] as const)("renders the %s tone with its role", (tone, cls, role) => {
    render(<AnnouncementBar tone={tone} aria-label="Heads up">Message</AnnouncementBar>);
    const bar = screen.getByRole(role, { name: "Heads up" });
    expect(bar).toHaveTextContent("Message");
    expect(bar).toHaveClass(cls);
  });

  it("lets the caller pick the role", () => {
    render(<AnnouncementBar tone="critical" role="status">Message</AnnouncementBar>);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("renders an in-app link, a full-navigation link, a button and a form action", async () => {
    const onClick = vi.fn();
    const formAction = vi.fn();
    const { rerender } = render(<AnnouncementBar tone="info" action={{ label: "Go", track: "go", href: "/somewhere" }}>m</AnnouncementBar>);
    expect(screen.getByRole("link", { name: "Go" })).toHaveAttribute("href", "/somewhere");
    expect(screen.getByRole("link", { name: "Go" })).toHaveAttribute("data-track", "go");

    rerender(<AnnouncementBar tone="info" action={{ label: "Go", track: "go", href: "/api/x", external: true }}>m</AnnouncementBar>);
    expect(screen.getByRole("link", { name: "Go" })).toHaveAttribute("href", "/api/x");

    rerender(<AnnouncementBar tone="notice" action={{ label: "Do it", track: "do", onClick }}>m</AnnouncementBar>);
    await userEvent.click(screen.getByRole("button", { name: "Do it" }));
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(<AnnouncementBar tone="critical" action={{ label: "Exit", track: "exit", formAction }}>m</AnnouncementBar>);
    await userEvent.click(screen.getByRole("button", { name: "Exit" }));
    expect(formAction).toHaveBeenCalledTimes(1);
  });

  it("is hidden in the server render of a dismissible bar, and shown once storage says it wasn't dismissed", async () => {
    const dismiss = { dismissKey: "k", scope: "session" as const };
    expect(renderToString(<AnnouncementBar tone="info" dismiss={dismiss}>Message</AnnouncementBar>)).toBe("");
    render(<AnnouncementBar tone="info" dismiss={dismiss}>Message</AnnouncementBar>);
    expect(await screen.findByText("Message")).toBeInTheDocument();
  });

  it("a bar without dismiss is in the server render", () => {
    expect(renderToString(<AnnouncementBar tone="info">Message</AnnouncementBar>)).toContain("Message");
  });

  it("remembers a session dismissal in sessionStorage only", async () => {
    render(<AnnouncementBar tone="info" dismiss={{ dismissKey: "k", scope: "session", label: "Later" }}>Message</AnnouncementBar>);
    await userEvent.click(await screen.findByRole("button", { name: "Later" }));
    expect(screen.queryByText("Message")).not.toBeInTheDocument();
    expect(sessionStorage.getItem("k")).toBe("1");
    expect(localStorage.getItem("k")).toBeNull();
  });

  it("remembers a device dismissal in localStorage across a remount", async () => {
    const { unmount } = render(<AnnouncementBar tone="notice" dismiss={{ dismissKey: "k", scope: "device" }}>Message</AnnouncementBar>);
    await userEvent.click(await screen.findByRole("button", { name: "Not now" }));
    expect(localStorage.getItem("k")).toBe("1");
    expect(sessionStorage.getItem("k")).toBeNull();
    unmount();
    render(<AnnouncementBar tone="notice" dismiss={{ dismissKey: "k", scope: "device" }}>Message</AnnouncementBar>);
    expect(screen.queryByText("Message")).not.toBeInTheDocument();
  });

  it("still shows and dismisses for the visit when storage is blocked", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<AnnouncementBar tone="info" dismiss={{ dismissKey: "k", scope: "device" }}>Message</AnnouncementBar>);
    await userEvent.click(await screen.findByRole("button", { name: "Not now" }));
    expect(screen.queryByText("Message")).not.toBeInTheDocument();
  });
});

describe("AnnouncementStack", () => {
  const bar = (name: string) => <p data-testid="bar">{name}</p>;

  it("renders every bar, highest priority first, skipping those that don't apply", () => {
    render(
      <AnnouncementStack
        items={[
          { id: "slack", priority: ANNOUNCEMENT_PRIORITY.slackConnect, element: bar("slack") },
          { id: "none", priority: 999, element: false },
          { id: "sudo", priority: ANNOUNCEMENT_PRIORITY.sudo, element: bar("sudo") },
          { id: "install", priority: ANNOUNCEMENT_PRIORITY.installApp, element: bar("install") },
          { id: "tie", priority: ANNOUNCEMENT_PRIORITY.installApp, element: bar("tie") },
        ]}
      />,
    );
    expect(screen.getAllByTestId("bar").map((el) => el.textContent)).toEqual(["sudo", "install", "tie", "slack"]);
  });

  it("renders nothing when no bar applies", () => {
    const { container } = render(<AnnouncementStack items={[{ id: "a", priority: 1, element: null }]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
