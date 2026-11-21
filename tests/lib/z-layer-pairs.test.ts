import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import config from "@/config/tailwind";

/**
 * Pairs of things that overlap in practice, and which must win. The scale (`config/tailwind.ts`) is
 * only half of getting stacking right: a layer is also picked per component, and a wrong pick shows
 * only when two things happen to meet (the hover toolbar under the day divider, a popover under a
 * sticky bar). Each side is read from the real class on the component, so changing one fails here
 * with the pair named; a pattern that stops matching fails too, so a rename can't skip a check.
 * A new overlap that went wrong in the browser gets a line here.
 */
const zIndex = (config.theme as { extend: { zIndex: Record<string, string> } }).extend.zIndex;
const root = path.resolve(__dirname, "../..");

/** The layer a component's class names: the first capture group of `pattern` in `file`. */
const layer = (file: string, pattern: RegExp): string => {
  const match = pattern.exec(fs.readFileSync(path.join(root, file), "utf8"));
  if (!match) throw new Error(`${file}: nothing matches ${pattern}`);
  expect(Object.keys(zIndex), `${file}: z-${match[1]}`).toContain(match[1]);
  return match[1];
};

const things = {
  chatToolbar: ["src/components/chat/MessageActions.tsx", /absolute -top-3 right-2 z-([\w-]+)/],
  dayDivider: ["src/components/chat/MessageList.tsx", /<div className="sticky top-0 z-([\w-]+)/],
  newMessagesBar: ["src/components/chat/NewMessagesBanner.tsx", /sticky top-12 z-([\w-]+)/],
  appHeader: ["src/components/AppHeader.tsx", /<header[^>]*relative z-([\w-]+)/],
  contentDropdown: ["src/components/chat/MessageBox.tsx", /absolute bottom-full left-0 z-([\w-]+) mb-1 max-h-56/],
  pickerList: ["src/components/EntitySearch.tsx", /fixed z-([\w-]+) bg-white dark:bg-slate-800 border/],
  railOpen: ["src/components/MemberNavigation.tsx", /railOpen \? "z-([\w-]+)" : "z-[\w-]+"/],
  railClosed: ["src/components/MemberNavigation.tsx", /railOpen \? "z-[\w-]+" : "z-([\w-]+)"/],
  adminRailOpen: ["src/app/(admin)/admin/AdminNavigation.tsx", /railOpen \? "z-([\w-]+)" : "z-[\w-]+"/],
  mobileDrawer: ["src/components/MemberNavigation.tsx", /lg:hidden fixed inset-y-0 left-0 z-([\w-]+)/],
  modal: ["src/components/Modal.tsx", /fixed inset-0 bg-black\/50 flex items-center justify-center z-([\w-]+)/],
  cornerWidget: ["src/components/FeedbackWidget.tsx", /fixed right-4 top-16 z-([\w-]+)/],
  searchPalette: ["src/components/search/SearchPalette.tsx", /fixed inset-0 z-([\w-]+)/],
  tourHighlight: ["src/components/onboarding/OnboardingSpotlight.tsx", /className="fixed z-([\w-]+) pointer-events-none/],
  tourPopup: ["src/components/onboarding/OnboardingSpotlight.tsx", /className="fixed z-([\w-]+) rounded-lg border/],
  actionMenu: ["src/components/ActionMenu.tsx", /fixed z-([\w-]+) w-56/],
} as const;
type Thing = keyof typeof things;
const value = (t: Thing) => Number(zIndex[layer(things[t][0], things[t][1])]);

const PAIRS: Array<[above: Thing, below: Thing, why: string]> = [
  ["chatToolbar", "dayDivider", "a message's hover toolbar, with its tooltips and emoji picker, sits over the sticky day divider when the message is the first one under it"],
  ["dayDivider", "newMessagesBar", "the sticky divider covers the 'new messages' bar tucked under it"],
  ["appHeader", "dayDivider", "the header's popovers (On Air, help, user menu) rank as the header, so it must outrank the chat's sticky divider"],
  ["appHeader", "contentDropdown", "and the dropdowns in the page, which scroll under the header"],
  ["railOpen", "appHeader", "the sidebar opened over the page covers the header's search box"],
  ["adminRailOpen", "appHeader", "the same in admin"],
  ["appHeader", "railClosed", "the collapsed rail stays under the header"],
  ["mobileDrawer", "appHeader", "the mobile menu covers the header"],
  ["modal", "appHeader", "a modal covers the header"],
  ["modal", "cornerWidget", "a modal covers the corner widgets (feedback, environment, tour guide)"],
  ["modal", "contentDropdown", "a modal covers dropdowns of the page behind it"],
  ["searchPalette", "modal", "the search palette opens over a modal"],
  ["tourPopup", "modal", "the tour's popup is not hidden by a modal"],
  ["tourPopup", "tourHighlight", "the tour's popup sits over its own highlight"],
];

describe("z-layers of things that overlap", () => {
  it.each(PAIRS)("%s is above %s: %s", (above, below) => {
    expect(value(above)).toBeGreaterThan(value(below));
  });

  it("keeps a menu that opens from inside a modal at least as high as the modal", () => {
    expect(value("actionMenu")).toBeGreaterThanOrEqual(value("modal"));
    expect(value("pickerList")).toBeGreaterThanOrEqual(value("modal"));
  });
});
