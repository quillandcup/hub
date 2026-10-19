import { describe, it, expect } from "vitest";
import { idsToSoftDelete, parseKajabiCourse } from "@/lib/kajabi/courses";

const res = (type: string, id: string, attributes: Record<string, unknown> = {}, relationships: Record<string, any> = {}) => ({
  id,
  type,
  attributes,
  relationships,
});
const one = (type: string, id: string) => ({ data: { id, type } });
const many = (type: string, ...ids: string[]) => ({ data: ids.map((id) => ({ id, type })) });

describe("parseKajabiCourse", () => {
  it("reads the course, modules (with nesting), lessons, media length and offers", () => {
    const parsed = parseKajabiCourse({
      data: res("courses", "c1", { title: "The Ready Writer", description: "Write" }),
      included: [
        res("modules", "m1", { title: "Month 1", position: 1, publishing_option: "published", poster_image_url: "https://x/p.png" }),
        res("modules", "m2", { title: "Week 1", position: "1", publishing_option: "locked" }, { parent_module: one("modules", "m1") }),
        res("lessons", "l1", { title: "Intro", position: 2, publishing_option: "published" }, { module: one("modules", "m2"), media: many("media", "v1") }),
        res("media", "v1", { duration_in_minutes: 9.5 }),
        res("offers", "o1", { name: "Ready Writer" }),
      ],
    });

    expect(parsed.course).toMatchObject({ kajabiId: "c1", title: "The Ready Writer", description: "Write" });
    expect(parsed.modules).toMatchObject([
      { kajabiId: "m1", parentKajabiId: null, position: 1, posterUrl: "https://x/p.png", publishingOption: "published" },
      { kajabiId: "m2", parentKajabiId: "m1", position: 1, publishingOption: "locked" },
    ]);
    expect(parsed.lessons).toMatchObject([{ kajabiId: "l1", moduleKajabiId: "m2", position: 2, videoDurationSeconds: 570 }]);
    expect(parsed.offers).toEqual([{ kajabiId: "o1", title: "Ready Writer" }]);
    expect(parsed.unplacedLessons).toBe(0);
  });

  it("places a lesson from the module's side when the lesson doesn't name its module", () => {
    const parsed = parseKajabiCourse({
      data: res("courses", "c1", { title: "C" }),
      included: [
        res("modules", "m1", { title: "M" }, { lessons: many("lessons", "l1") }),
        res("lessons", "l1", { title: "L" }),
      ],
    });
    expect(parsed.lessons[0].moduleKajabiId).toBe("m1");
    expect(parsed.unplacedLessons).toBe(0);
  });

  it("counts lessons it couldn't place, so a surprise in the live shape shows in the import result", () => {
    const parsed = parseKajabiCourse({
      data: res("courses", "c1", { title: "C" }),
      included: [res("modules", "m1", { title: "M" }), res("lessons", "l1", { title: "L" })],
    });
    expect(parsed.lessons[0].moduleKajabiId).toBeNull();
    expect(parsed.unplacedLessons).toBe(1);
  });

  it("doesn't count lessons as unplaced in a course with no modules", () => {
    const parsed = parseKajabiCourse({ data: res("courses", "c1", { title: "C" }), included: [res("lessons", "l1", { title: "L" })] });
    expect(parsed.unplacedLessons).toBe(0);
  });

  it("ignores a parent module that isn't in the response", () => {
    const parsed = parseKajabiCourse({
      data: res("courses", "c1", { title: "C" }),
      included: [res("modules", "m1", { title: "M" }, { parent_module: one("modules", "gone") })],
    });
    expect(parsed.modules[0].parentKajabiId).toBeNull();
  });

  it("rejects a response with no course", () => {
    expect(() => parseKajabiCourse({ data: undefined as any })).toThrow(/no data.id/);
  });
});

describe("idsToSoftDelete", () => {
  it("returns live ids a complete fetch no longer has", () => {
    expect(idsToSoftDelete(["a", "b", "c"], ["b"])).toEqual(["a", "c"]);
    expect(idsToSoftDelete([], ["b"])).toEqual([]);
  });
});
