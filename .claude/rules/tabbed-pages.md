---
paths:
  - "src/lib/tab-routes.ts"
  - "src/components/Tab*.tsx"
  - "src/app/**/page.tsx"
  - "src/app/**/*Page.tsx"
---

### Tabbed Pages: Tabs Are Paths

**RULE**: A tabbed page's tabs are URL paths, never `?tab=`: the first tab at the base path, the rest at `<basePath>/<id>` (`/my-prickles`, `/my-prickles/all`; `/settings/notifications`). See `src/lib/tab-routes.ts`.

- The page's content lives in a shared server component taking `tab` (e.g. `src/app/(member)/my-prickles/MyPricklesPage.tsx`). The base `page.tsx` renders the first tab and calls `redirectLegacyTabParam` so old `?tab=` links (Slack DMs, calendar feeds, bookmarks) still land; each other tab is a folder whose `page.tsx` renders the shared component with its id. Static folders, not a catch-all, so they coexist with `[id]` siblings (`/projects/books` vs `/projects/[id]`).
- Render `<Tabs basePath="/my-prickles" initialTab={tab} key={tab}>`: clicks switch instantly on the client and rewrite the path with `history.replaceState` (no server round trip). Controlled `TabBar` users call `replaceTabPath` + `useFollowTabPath`. Keep tab ids in a plain module, not a `"use client"` file, if a server page needs them.
- Titles: export the page title and a tab-label map from the shared component and use them for the tab labels, each route's `metadata.title` (`tabTitle()` in `src/lib/tab-routes.ts` from `{ record?, section? }`: always most specific first, record · tab · section, since browsers cut titles off on the right; "All Prickles · My Prickles", "Fern Quillsby · Slack Activity"; no tab name on the first tab) and `<Tabs pageTitle>`, which sets `document.title` to the same string on a client tab switch (controlled `TabBar`: `setTabDocumentTitle`).
- Server actions `revalidatePath(basePath, "layout")` so every tab path refreshes.
- Query params are for state within a tab (`/my-prickles/all?commit=...`); switching tabs drops them.
