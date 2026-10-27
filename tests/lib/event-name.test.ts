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

  it("names the host when there is no speaker, the way prickle titles do (first name and last initial)", () => {
    expect(eventDisplayName("Progress Prickle", null, "Jenn Parker")).toBe("Progress Prickle with Jenn P");
    expect(eventDisplayName("Progress Prickle", undefined, "Bestie")).toBe("Progress Prickle with Bestie");
    expect(eventDisplayName("Progress Prickle", "  ", "  ")).toBe("Progress Prickle");
    expect(eventDisplayName("Progress Prickle", null, null)).toBe("Progress Prickle");
  });

  it("names the speaker rather than the host when there is both, and never says a name twice", () => {
    expect(eventDisplayName("Query Letters", "Sam Example", "Jenn Parker")).toBe("Query Letters with Sam Example");
    expect(eventDisplayName("Progress Prickle with Jenn P", null, "Jenn Parker")).toBe("Progress Prickle with Jenn P");
  });
});
