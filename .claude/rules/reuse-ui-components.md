## reuse-ui-components

Before building UI, look in `components/` for what already does the job, and use it or extend it. Rebuilding a variant is the usual reason a review comes back with "use the X component instead".

**Existing building blocks** (check the directory for newer ones):
- Member and staff pickers: `EntitySearch` and `MultiEntitySearch` are the base; `MemberSearch`, `MultiMemberSearch`, `StaffSearch`, `MultiSelectSearch`, `SudoMemberSearch` are older or specialised. Anywhere a person types or picks members (segment editors, filters, assignments), use these, never a free-text field for emails or names. New pickers extend `EntitySearch`; don't add another standalone one.
- Dates: `DatePicker`. Wrap a native or third-party control in our own component the first time it's used, so it can be swapped in one place.
- Tables: `SortableTh` for sorting (date columns must sort by value, not by text) and `DataTablePager` for pagination. Don't hand-roll sorting or paging in a page.
- Tabbed pages: `Tabs`, with the path-based routing in `CLAUDE.md`.

**Rules of thumb**
- Needing a variant (a selectable row, a different empty state) means adding a prop to the shared component, not copying it.
- If you must add a new shared component, put it in `components/`, take props rather than reaching into app state, and add a component test.
- **Symmetric features share code.** When two features mirror each other (check-in and check-out, member and admin views of the same data), they use one function for "who is this offered to" and parallel names, tables and behavior, so they can't drift. Fix both together.
- **Copy**: short, no "optional" labels, an obvious next step. A button says "Skip it" rather than a paragraph saying it's optional.
- Match the Quill & Cup colors and fonts already in the theme; don't introduce new colors inline.
- Layout rules (viewport vs container queries, breakpoints) are in `CLAUDE.md`; check a change just either side of each breakpoint it touches.

**Bars and banners** (`components/announcements/`):
- A bar across the app above the header (sudo, install the app, connect Slack) is an `AnnouncementBar` placed by `AnnouncementStack` in `app/(member)/layout.tsx`: one item with an `id`, a `priority` from `ANNOUNCEMENT_PRIORITY` and the element, keeping its own show condition in the layout. They all stack, highest priority first, so a critical bar is never hidden. Don't render a bar of your own markup there.
- State of one page ("you're previewing") is a `PageBanner` first in the page, under the header. Not a bar in the layout.
- An event the app sends (time-sensitive, stored, read/unread) is a notification (`timeSensitiveUntil`), not a bar; the notification banners share the `notice` look through `ANNOUNCEMENT_TONE_CLASSES`.
- Tones: `info` (something worth doing), `notice` (state of the page, notification), `critical` (sudo). Dismissal is `dismiss` on the bar (`scope` "session" or "device"), never your own storage code.
