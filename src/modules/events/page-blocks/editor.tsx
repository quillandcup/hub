"use client";

import type { Field } from "@puckeditor/core";
import type { PageBlockEditorContribution } from "@/components/landing/editor-kit";
import { COMING_UP_KIND_OPTIONS } from "./live-kinds";

/** Tick boxes for the kinds of event a live Coming up block lists. The value is the ticked kinds; none ticked means every kind. */
export function KindsField({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      {COMING_UP_KIND_OPTIONS.map((kind) => (
        <label key={kind.value} className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={value.includes(kind.value)} onChange={(e) => onChange(e.target.checked ? [...value, kind.value] : value.filter((v) => v !== kind.value))} />
          {kind.label}
        </label>
      ))}
    </div>
  );
}

/** Tick boxes for the kinds of event a live Coming up block lists; the value is the list of ticked kinds. */
const kindsField = (label: string): Field => ({
  type: "custom",
  label,
  render: ({ value, onChange }) => <KindsField value={Array.isArray(value) ? (value as string[]) : []} onChange={onChange} />,
});

/** The editor fields of the events integration's blocks (the editor side of `index.ts`; a client bundle, since the fields carry the media picker). */
export const eventsEditorFields: PageBlockEditorContribution = {
  id: "events",
  fields: ({ text, select, toggle, image, link, source, itemsSlot }) => ({
    AnnouncementStrip: {
      text: text("Line of news"),
      buttonLabel: text("Button label"),
      href: text("Button link (https://, or a path on this site)"),
      tone: select("Colour", [{ label: "Gold", value: "gold" }, { label: "Plum", value: "plum" }, { label: "Charcoal", value: "charcoal" }]),
      source,
      whenNone: select("When live and no prickle is coming up within a day", [{ label: "Show nothing", value: "hide" }, { label: "Show the line typed above", value: "typed" }]),
    },
    SchedulePanel: {
      title: text("Panel title"),
      zoneLabel: text("Time zone note (for example, the zone the times are in; live names the zone for you)"),
      source,
      hoursAhead: { type: "number", label: "Live: how many hours ahead to show (1 to 144)", min: 1, max: 144 },
      maxRows: { type: "number", label: "Live: most sessions to show (1 to 6)", min: 1, max: 6 },
      hostStyle: select("Live: line about the host", [{ label: "None", value: "none" }, { label: "An experienced host (100 or more prickles hosted)", value: "experience" }]),
      experiencedHostText: text("Live: words under a session with an experienced host (no names are ever shown)"),
      openLabel: text("Live: label on a session that is not on now or starting within the hour (leave empty for none: a label that is the same on every row says nothing)"),
      rowNote: text("Live: line under every session that has no host line (use sparingly: the same words on every row say little; for what is true of all of them, use the line under the list)"),
      footer: text("One line under the whole list (for example, Camera optional. Everyone is welcome.)"),
      emptyText: text("Live: line to show when nothing is coming up"),
      items: itemsSlot("SchedulePanel", "Sessions when typed by hand (up to 6)"),
    },
    ScheduleRow: {
      time: text("Time"),
      title: text("Session name"),
      status: text("Status text (for example, Live, In 42 min)"),
      state: select("Status look", [{ label: "Live now", value: "live" }, { label: "Starting soon", value: "soon" }, { label: "Open", value: "open" }]),
      host: text("Line about the host (optional)"),
    },
    ComingUp: {
      heading: text("Heading above the events (optional; a list says Upcoming sessions until you type one)"),
      style: select("How to show them", [
        { label: "Cards", value: "cards" },
        { label: "Feature tiles with the event's picture (for retreats and workshops)", value: "feature" },
        { label: "A plain list with dates (for sessions)", value: "list" },
      ]),
      source,
      kinds: kindsField("Live: which kinds of event to show (none ticked: every kind)"),
      max: { type: "number", label: "Live: most events to show (1 to 4)", min: 1, max: 4 },
      more: link("Link under the events (optional, for example, See all events)"),
      waitlist: { type: "object", label: "Feature tiles: link shown on a sold-out event (only when it has a link)", objectFields: { label: text("Link label (empty: Join the waitlist)"), href: text("Link (https://, or a path on this site)") } },
      items: {
        type: "array",
        label: "Events when typed by hand (up to 4)",
        max: 4,
        arrayFields: {
          kind: text("Kind (for example, Retreat)"),
          title: text("Title"),
          when: text("Dates and place"),
          date: text("List: first day, as year-month-day (for example, 2027-03-13), for the date tile"),
          time: text("List: time under the title (for example, 8 – 9 pm ET; empty shows the dates and place)"),
          imageAssetId: image("Feature tiles: picture"),
          soldOut: toggle("Sold out (a feature tile then shows the waitlist link)"),
          availability: text("Availability (for example, 6 spots left)"),
          status: select("Status pill (optional)", [{ label: "None", value: "" }, { label: "Open", value: "open" }, { label: "Waitlist", value: "waitlist" }, { label: "Coming soon", value: "soon" }, { label: "Dates announced", value: "dates" }]),
          linkLabel: text("Link label (optional)"),
          href: text("Link (https://, or a path on this site)"),
        },
        defaultItemProps: { kind: "", title: "New card", when: "", date: "", time: "", imageAssetId: "", soldOut: false, availability: "", status: "", linkLabel: "", href: "" },
        getItemSummary: (i) => i.title || "Card",
      },
    },
  }),
};
