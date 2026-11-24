// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { editorConfig } from "@/components/landing/editor-config";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const page = (popup: Record<string, unknown>) => ({
  content: [
    { type: "Heading", props: { id: "h", text: "The page", level: "h1", align: "center" } },
    { type: "ExitPopup", props: { id: "p", enabled: true, label: "Join", content: [{ type: "Heading", props: { id: "ph", text: "Only in the popup", level: "h2", align: "center" } }], ...popup } },
  ],
  root: { props: {} },
});

async function renderPage(data: unknown) {
  // Puck's client entry needs ResizeObserver when it loads, so it is imported after the stub.
  globalThis.ResizeObserver = ResizeObserverStub as never;
  const { default: LandingRender } = await import("@/components/landing/LandingRender");
  return render(<LandingRender data={data} />);
}

describe("an Exit popup on a rendered page", () => {
  it("leaves the page itself alone and keeps the popup's blocks out of the page until it shows: nothing but a hidden anchor, no layout, no heading", async () => {
    const { container } = await renderPage(page({}));
    expect(screen.getByRole("heading", { level: 1, name: "The page" })).toBeInTheDocument();
    expect(screen.queryByText("Only in the popup")).toBeNull();
    expect(container.querySelector("[data-exit-popup-anchor]")).toHaveAttribute("hidden");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("draws nothing at all while it is switched off", async () => {
    const { container } = await renderPage(page({ enabled: false }));
    expect(container.querySelector("[data-exit-popup-anchor]")).toBeNull();
    expect(screen.queryByText("Only in the popup")).toBeNull();
  });
});

describe("the editor's fields for the Exit popup", () => {
  const fields = editorConfig.components.ExitPopup.fields as Record<string, { type: string; allow?: string[]; min?: number; max?: number }>;

  it("has the switch, the Edit popup switch, the blocks, the trigger, the frequency, the device and layout settings", () => {
    expect(Object.keys(fields)).toEqual(["enabled", "editPopup", "content", "trigger", "delaySeconds", "rememberDays", "popupName", "closeOnOverlay", "hideOnDesktop", "hideOnMobile", "label", "width", "background"]);
    expect(fields.editPopup.type).toBe("custom");
  });

  it("takes a picture, words, a button and the sign-up form in the popup, and no popup, section or part of a list", () => {
    expect(fields.content.type).toBe("slot");
    expect(fields.content.allow).toEqual(["Image", "Heading", "RichText", "Button", "OptInForm", "Divider", "Spacer"]);
  });

  it("limits the seconds and the days to what the page accepts", () => {
    expect([fields.delaySeconds.min, fields.delaySeconds.max]).toEqual([1, 300]);
    expect([fields.rememberDays.min, fields.rememberDays.max]).toEqual([0, 365]);
  });
});
