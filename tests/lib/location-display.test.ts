import { describe, expect, it } from "vitest";
import { locationDisplay } from "@/lib/location-display";

describe("locationDisplay", () => {
  it("shows a place as typed, with nothing to join", () => {
    expect(locationDisplay("Cedar Lodge, Virginia")).toEqual({ text: "Cedar Lodge, Virginia", href: null, joinLabel: null });
    expect(locationDisplay("  Zoom room 2  ")).toEqual({ text: "Zoom room 2", href: null, joinLabel: null });
  });

  it("shows a video call link as Online, keeping the link (and its password) out of the text", () => {
    const url = "https://us06web.zoom.us/j/87106462893?pwd=TWbsBeGLqqIAnId0Z3jJmSGOHXnWIj.1";
    expect(locationDisplay(url)).toEqual({ text: "Online (Zoom)", href: url, joinLabel: "Join on Zoom" });
    expect(locationDisplay("https://zoom.us/j/123")).toMatchObject({ text: "Online (Zoom)" });
    expect(locationDisplay("https://meet.google.com/abc-defg-hij")).toMatchObject({ text: "Online (Google Meet)", joinLabel: "Join on Google Meet" });
    expect(locationDisplay("https://teams.microsoft.com/l/meetup-join/xyz")).toMatchObject({ text: "Online (Microsoft Teams)" });
  });

  it("calls any other link Online", () => {
    expect(locationDisplay("https://example.com/room")).toEqual({ text: "Online", href: "https://example.com/room", joinLabel: "Join online" });
  });

  it("leaves text that merely contains a link alone, and an address that isn't a link", () => {
    expect(locationDisplay("Join at https://zoom.us/j/123")).toMatchObject({ text: "Join at https://zoom.us/j/123", href: null });
    expect(locationDisplay("https://")).toMatchObject({ text: "https://", href: null });
    expect(locationDisplay("zoom.us/j/123")).toMatchObject({ href: null });
  });

  it("is null when there is no location", () => {
    expect(locationDisplay(null)).toBeNull();
    expect(locationDisplay(undefined)).toBeNull();
    expect(locationDisplay("   ")).toBeNull();
  });
});
