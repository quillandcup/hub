import { describe, expect, it } from "vitest";
import { eventDisplayName } from "@/lib/event-name";

describe("eventDisplayName", () => {
  it("adds the speakers after the title", () => {
    expect(eventDisplayName("A Way to Make Money as an Author", "Brayden Bonnesen of AuthorTip")).toBe(
      "A Way to Make Money as an Author with Brayden Bonnesen of AuthorTip",
    );
    expect(eventDisplayName("Query Letters", "  Sam Example ")).toBe("Query Letters with Sam Example");
  });

  it("is just the title when there are no speakers", () => {
    expect(eventDisplayName("Hedgie Book Fair", null)).toBe("Hedgie Book Fair");
    expect(eventDisplayName("Hedgie Book Fair", undefined)).toBe("Hedgie Book Fair");
    expect(eventDisplayName("Hedgie Book Fair", "   ")).toBe("Hedgie Book Fair");
  });

  it("doesn't say the speaker twice when the title already names them", () => {
    expect(eventDisplayName("Craft Talk with Ada Example", "Ada Example")).toBe("Craft Talk with Ada Example");
    expect(eventDisplayName("Craft Talk with ADA EXAMPLE", "Ada Example")).toBe("Craft Talk with ADA EXAMPLE");
  });
});
