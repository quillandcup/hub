import { describe, it, expect } from "vitest";
import { memberMatchHint } from "@/lib/search/member-match-hint";

const penny = { name: "Penelope Legal", displayName: "Penny Pen", email: "pp@example.test" };

describe("memberMatchHint", () => {
  it("says nothing when the title already explains the match", () => {
    expect(memberMatchHint(["penny"], penny)).toBeNull();
    expect(memberMatchHint(["PEN"], penny)).toBeNull();
    expect(memberMatchHint([], penny)).toBeNull();
    expect(memberMatchHint(["  "], penny)).toBeNull();
  });

  it("names the legal name when only it contains the word", () => {
    expect(memberMatchHint(["penelope"], penny)).toBe("Penelope Legal");
    expect(memberMatchHint(["legal"], penny)).toBe("Penelope Legal");
  });

  it("shows the email when only it contains the word", () => {
    expect(memberMatchHint(["pp@ex"], penny)).toBe("pp@example.test");
    expect(memberMatchHint(["pp@ex"], { ...penny, email: undefined })).toBeNull(); // member search never has one
  });

  it("names the nickname when nothing else on the member contains the word", () => {
    const aliasFor = (w: string) => (w === "quillfoot" ? "Quillfoot Jr" : undefined);
    expect(memberMatchHint(["quillfoot"], { ...penny, aliasFor })).toBe("also known as “Quillfoot Jr”");
    expect(memberMatchHint(["quillfoot"], penny)).toBeNull();
  });

  it("explains the first word the title doesn't cover", () => {
    expect(memberMatchHint(["penny", "legal"], penny)).toBe("Penelope Legal");
    expect(memberMatchHint(["penny", "pen"], penny)).toBeNull();
  });

  it("needs no hint for a word found in other text that is shown, like a bio", () => {
    expect(memberMatchHint(["dragons"], { ...penny, alsoShown: ["Writes about dragons"], aliasFor: () => "Wrong" })).toBeNull();
  });

  it("uses the legal name as the title when there is no display name", () => {
    expect(memberMatchHint(["penelope"], { name: "Penelope Legal", displayName: "  " })).toBeNull();
  });
});
