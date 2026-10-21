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
