// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { useMirrorHostTheme } from "@/app/(admin)/admin/pages/[slug]/useMirrorHostTheme";

function Probe() {
  useMirrorHostTheme();
  return null;
}

function addFrame() {
  const frame = document.createElement("iframe");
  frame.id = "preview-frame";
  document.body.appendChild(frame);
  return frame.contentDocument!.documentElement;
}

describe("useMirrorHostTheme", () => {
  afterEach(() => {
    cleanup();
    document.getElementById("preview-frame")?.remove();
    document.documentElement.removeAttribute("class");
    document.documentElement.removeAttribute("style");
  });

  it("copies the host theme onto the canvas frame when it mounts", () => {
    document.documentElement.className = "dark";
    const frameHtml = addFrame();
    render(<Probe />);
    expect(frameHtml.className).toBe("dark");
  });

  it("follows a theme change after mount, in both directions", async () => {
    document.documentElement.className = "dark";
    const frameHtml = addFrame();
    render(<Probe />);

    document.documentElement.className = "light";
    document.documentElement.style.colorScheme = "light";
    await waitFor(() => expect(frameHtml.className).toBe("light"));
    expect(frameHtml.style.colorScheme).toBe("light");

    document.documentElement.removeAttribute("class");
    await waitFor(() => expect(frameHtml.hasAttribute("class")).toBe(false));
  });

  it("does nothing when there is no canvas frame yet", () => {
    document.documentElement.className = "dark";
    expect(() => render(<Probe />)).not.toThrow();
  });

  it("stops watching on unmount", async () => {
    const frameHtml = addFrame();
    const { unmount } = render(<Probe />);
    unmount();
    document.documentElement.className = "dark";
    await new Promise((r) => setTimeout(r, 20));
    expect(frameHtml.className).toBe("");
  });
});
