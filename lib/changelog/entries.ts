/**
 * The Hedgie Hub changelog: one entry per release a member would notice, newest first or not (the
 * helpers sort). This file is the single source: the in-app pages (/changelog), the
 * admin Changelog (engineering entries too) and the "What's new" digest all read it.
 * Written for members: say what they can now do, not what changed in the code. See docs/CHANGELOG_PROCESS.md.
 *
 * Screenshots live in public/changelog/<slug>/ (the repo and that folder are public: no member data in
 * them) and are written in `body` as `![alt](/changelog/<slug>/<file>.png)`. `image` is the one shown on
 * the list, the digest and the Slack post.
 */

export const CHANGELOG_CATEGORIES = {
  new: "New",
  improved: "Improved",
  fixed: "Fixed",
} as const;

export type ChangelogCategory = keyof typeof CHANGELOG_CATEGORIES;

/**
 * Who an entry is for. `product` entries are what members see: the What's new pages, the weekly digest, the
 * announcements post, and the admin Changelog. `staff` entries are about a tool staff use (Hedgie Care): only on the admin
 * Changelog (`/admin/changelog`), never on a member page, in the digest or in the announcements post, and they may carry
 * screenshots. `engineering` entries (platform improvements, or the lower-level detail behind a product update) appear only on
 * the admin Changelog with their body, and have no screenshots.
 */
export const CHANGELOG_AUDIENCES = {
  product: "Product",
  staff: "Staff",
  engineering: "Engineering",
} as const;

export type ChangelogAudience = keyof typeof CHANGELOG_AUDIENCES;

export interface ChangelogEntry {
  /** The permalink (`/changelog/<slug>`): lowercase words and hyphens. Never changed once published, so shared links keep working. */
  slug: string;
  /** The day it shipped, YYYY-MM-DD (Eastern). */
  date: string;
  audience: ChangelogAudience;
  category: ChangelogCategory;
  /**
   * A significant new capability (Hub Chat, Courses), as opposed to one more improvement: badged "Major" on the What's new
   * pages, first in the weekly digest and the announcements post, and marked on the admin Changelog. A separate dimension from
   * `category` (a major feature is also "new"), so it stays rare on purpose. Product entries only.
   */
  major?: boolean;
  title: string;
  /** One or two plain sentences (no markdown): the excerpt in the list, the digest and the Slack post. */
  summary: string;
  /** The full write-up in markdown: images as `/changelog/<slug>/<file>`, links to Hub pages as `/path`. */
  body: string;
  /** A screenshot shown with the summary: a path under /changelog/<slug>/. */
  image?: { src: string; alt: string };
}

export const CHANGELOG_ENTRIES: readonly ChangelogEntry[] = [
  {
    slug: "temporary-email-addresses",
    date: "2026-11-20",
    audience: "staff",
    category: "new",
    title: "Temporary-mail addresses are refused on sign-up forms, and flagged on members who arrived by import",
    summary: "The landing-page opt-in form and a member's \"add an email alias\" now refuse throwaway-inbox addresses. A new Data Health check lists active members who have one.",
    body: `Throwaway-inbox addresses (the kind that expire after a few minutes) are checked against a public list of such domains, including subdomains of a listed domain.

- **Refused:** the opt-in form on landing pages, and "add an email alias" in a member's settings. The person is asked to use their own address.
- **Flagged, not blocked:** most members still arrive by import from Kajabi or Stripe, and imports are never refused or changed. Open Data Health, then **Temporary Emails**, to see active members whose email, or an email alias, is on the list, with which address matched. The tile on Data Health shows the count.

The check only lists them; nothing happens to the member or the import.`,
  },
  {
    slug: "client-bundle-node-builtins-guard",
    date: "2026-11-20",
    audience: "engineering",
    category: "improved",
    title: "Browser code no longer pulls in Node's crypto, and a test keeps it out",
    summary: "The pages' browser bundle no longer carries copies of Node's crypto and vm modules, which asked the browser to run eval() and would have broken under a strict Content-Security-Policy.",
    body: [
      "**Rule: a module a client component can reach never imports a Node built-in** (`crypto`, `vm`, `stream`, `fs`...). The bundler answers such an import by shipping browser copies of those modules, and the `vm` copy calls `eval()`, which the Content-Security-Policy we are moving to refuses (Sentry reported it as a blocked string evaluation).",
      "- **Random ids and numbers** in shared code come from Web Crypto: `randomInt` in `lib/random-int.ts` and the global `crypto.randomUUID()`, the same in Node and the browser.\n- **A client component that needs a little of a server module** imports a small client-safe module instead (the chat sidebar uses `lib/chat/channels.ts`, which `lib/chat/load.ts` re-exports), never the whole loader.\n- **The guard** is `tests/lib/client-node-builtins.test.ts`: it follows imports from every `\"use client\"` file and fails with the chain that reaches a built-in. Files marked `server-only` or `\"use server\"` stop the walk.",
      "The page builder also loads Puck's `no-external.css`, which is `puck.css` without its import of a font from another site. Context: `docs/TODO.md`, \"CSP for scripts and styles (nonces)\".",
    ].join("\n\n"),
  },
  {
    slug: "writer-public-pages",
    date: "2026-11-20",
    audience: "engineering",
    category: "new",
    title: "Writers' public pages: an address, a name and a bio on the open web",
    summary: "A member can switch on a page of their own at /w/<handle>, shown to anyone without signing in and listed by search engines. Nothing is public until they turn it on.",
    body: "A page is off for everyone until its owner switches it on. It shows the name they choose (the display name, or a pen name they marked for it), their photo if they ticked it, and a bio written for the page. Nothing else from the member record is read into it.\n\n- **Rule:** a visitor's data comes only from `WriterProfileRepository.publicByHandle`, which builds the public fields in one place and runs with the service role; no table has an anonymous grant. `isProfilePubliclyServable` is the one function that decides whether a page is served.\n- **Handles** are lowercase letters, digits and single hyphens, unique whatever the case. A renamed handle redirects to the new one and stays held for its owner; the length, the hold and the reserved words are config (`writerProfiles` in `app.config.ts`).\n- **Pen names** show only when the member added the name themselves and marked it public.\n\nDetail and the routes: `docs/WRITER_PROFILES.md`.",
  },
  {
    slug: "landing-page-spacing-and-width",
    date: "2026-11-19",
    audience: "staff",
    category: "improved",
    title: "Page builder: set the space inside a section and the width of each block, for desktop and mobile",
    summary: "In the page builder you can now set the space inside a section on each side, with separate values for desktop and mobile, hide a section on desktop or on mobile, and give a block in a section a width out of 12 columns.",
    body: `Open a page in the admin Pages editor and select a section.

- **Space inside.** Top, bottom, left and right, in px, for desktop and for mobile, with None, Small, Medium and Large as quick picks for the top and bottom.
- **Hide on desktop or on mobile.** A hidden section is dimmed in the editor so you can still select it, and is left out of the page for visitors on that size.
- **Block width.** Select a block inside a section and click the Nth of twelve squares to make it N columns wide, on desktop and, if you want it different, on mobile. Reset puts it back to full width. Blocks with no width stay full width.

Desktop and mobile follow the room the page has, so the phone and tablet previews match a real phone. Pages built with the old Small, Medium and Large section space show the standard space until you set it again.`,
  },
  {
    slug: "landing-page-templates",
    date: "2026-11-20",
    audience: "engineering",
    category: "new",
    title: "Page builder: templates are pages of their own kind, with a draft, a published copy and History",
    summary: "An admin can save a page as a template, edit and publish it like any page, and start new pages or restart a page from its published copy. Templates are never on the public site.",
    body: `A template is a landing page with \`kind = 'template'\`, not a parallel system: the same editor, autosaved draft, published copy, versions, Bring back, JSON export and Activity Log entries. Only what is different is new.

- **Never public.** The one read behind the public route and the opt-in relay (\`published(slug)\`) returns only pages, and \`kind\` can't change once a row is made. Publishing a template shows its checks as warnings only and doesn't make its pictures public; a page made from it does that when it is published.
- **Using one.** New page's "Start from" and "Start over from a starter or template" list built-in starters and published templates, and copy the template's published copy (never its draft) into a draft. The old draft stays in History.
- **Saving one.** "Save as template" makes a new template from a page's draft, or replaces a template's draft (the old one stays in its History), optionally publishing in the same step. The page is never changed.
- **Immutable versions, with who and why.** No role can change or delete a version row. Each version shows who made it and an optional note (what changed at publish, or what replaced the draft it kept); the note stays on the version and out of the Activity Log.
- **Hooks.** \`LandingPageRepository.list(kind)\`, \`usableTemplates\`, the lifecycle registry's \`saveAsTemplate\` and \`replaceTemplate\`, the Templates tab under Pages.
- **Detail.** \`docs/LANDING_PAGES.md\`, "Templates".`,
  },
  {
    slug: "landing-page-json-round-trip",
    date: "2026-11-19",
    audience: "engineering",
    category: "new",
    title: "Page builder: export a page as JSON and import a changed file back",
    summary: "History in the page editor can download or copy a page's JSON (draft or published) and replace the draft from a file or pasted text, after a preview of what would change.",
    body: `A page can now leave the editor as a file, be changed elsewhere (this is how the owner and Claude iterate on a page, since Claude cannot write to production), and come back in one step.

- **Export** is built in the browser from what the editor holds: a small wrapper (\`format\`, \`version\`, address, title, which copy) around the document, with no row, user or audit data.
- **Import** treats the file as untrusted. A dry run and the real call share one code path (\`importLandingDraftJson\`): migrate, keep only blocks and props the builder has, clear pictures this library lacks, then sanitize as on save. The preview lists what was left out and what the publish check would raise.
- **It replaces the draft only.** The old draft is kept in History like a starter replacement, so Bring back undoes it.
- **Hook.** The set of props a block keeps is its defaults plus \`EXTRA_PROPS\` (\`lib/landing/json-transfer.ts\`); a test fails when the editor gains a field that is in neither.
- **Detail.** \`docs/LANDING_PAGES.md\`, "Export and import".`,
  },
  {
    slug: "landing-page-homepage-blocks",
    date: "2026-11-18",
    audience: "engineering",
    category: "new",
    title: "Page builder blocks for the new homepage, and a Homepage starter built from them",
    summary: "Ten blocks (announcement strip, schedule panel, outcome numbers, Finisher cards, timeline, week strip, finish-line cards, plan phases, journey map, coming up) and a Homepage starter; four of them can show live Hub data: figures, upcoming prickles and upcoming events.",
    body: `The homepage needed blocks that do one job each, so the builder has a "Homepage" group (\`components/landing/homepage-blocks.tsx\`) and a Homepage starter that arranges them as an unpublished draft. Not offered to the AI builder.

- **Rules.** Container-query sizes only, theme tokens or fixed brand colours, a link is a prop named \`href\`. Fewer boxes on purpose: a page should not be a wall of identical cards.
- **Live data.** Four blocks take a \`source\` (typed or live). The server fills live values in before the render (\`resolveLiveBlocks\`, cached for a minute, never saved) as a render-only \`live\` prop; a failure shows the typed values. Counts and public titles only, never a person.
- **Journey map.** One panel per stage, led by one featured offer with the rest as a short list of links; the one client part is \`JourneyTabs\`, over server-rendered panels.
- **Coming up** has three styles: cards, feature tiles with the event's cover (only when its media asset is already public; saving a publicly announced event marks it), and a plain dated list.
- **Detail.** \`docs/LANDING_PAGES.md\`, "Homepage blocks" and "Live data".`,
  },
  {
    slug: "fixes-2026-11-17",
    date: "2026-11-17",
    audience: "product",
    category: "fixed",
    title: "Small fixes on your dashboard, project page and phone",
    summary: "Your dashboard lists each project's title once above its starred goals. On a phone, a project's buttons wrap instead of running off the screen, and you can press and hold a button to see its hint.",
    body: [
      "- **Writing Goals on your dashboard** list each project's title once, with its starred goals under it, instead of repeating the title on every goal.",
      "- **A project's page on a phone**: the visibility switch, status, Edit details and Export CSV now wrap onto the next line instead of running off the right edge.",
      "- **Hints on buttons**: on a phone or tablet, press and hold a button to see its hint, such as \"Drag to reorder\". Tapping works as it always did.",
    ].join("\n"),
  },
  {
    slug: "member-activity-date-range",
    date: "2026-11-17",
    audience: "staff",
    category: "improved",
    title: "A member's Activity tab: pick the days you want, and the community manager can open it",
    summary: "On a member's Activity tab you can pick a date range, or choose all time. The community manager now has her own Activity tab there, showing only the member's own activity.",
    body: `Open a member in the admin pages and choose **Activity**.

- **Date range.** Beside the 24h, 7d, 30d, 90d and 1y buttons there is now **All time**, and a From and To pair of dates with **Apply** for any stretch in between. Days are Eastern days, and the whole To day is included. If the dates don't make sense (From after To, or a day that hasn't happened yet), the page says so and shows the usual range.
- **For the community manager.** She sees what the member did, what staff did for them (a reach-out, a care plan step) and what an admin did while viewing as them. She does not see the record of staff changes to the member's details, which pages they visited, staff notes, or the central Activity Log.
- **What it adds up to.** What Hedgie Care lists under "Activity during this plan" is always part of her tab, and her tab is part of what admins see.`,
  },
  {
    slug: "sign-in-links-last-one-hour",
    date: "2026-11-18",
    audience: "product",
    category: "improved",
    title: "Sign-in links and codes expire after one hour",
    summary:
      "The link and the code in a sign-in email work for one hour, and each works only once. If the hour has passed, ask for a new one on the sign-in page.",
    body: [
      "Sign-in, invitation and password reset emails used to stay usable for a day. They now last one hour, so a link that is forwarded by mistake or left in an old inbox stops working much sooner.",
      "![The sign-in page, with a box for the code from your email](/changelog/sign-in-links-last-one-hour/01-sign-in-code.webp)",
      "If the hour has passed, go to the [sign-in page](/login) and ask for a new link or code. Someone who was invited but has not accepted yet can ask for a fresh invitation on that page too.",
    ].join("\n\n"),
    image: { src: "/changelog/sign-in-links-last-one-hour/01-sign-in-code.webp", alt: "The sign-in page, with a box for the code from your email" },
  },
  {
    slug: "sign-in-link-works-on-any-device",
    date: "2026-11-18",
    audience: "product",
    category: "improved",
    title: "The sign-in link in your email now works on any device",
    summary:
      "You can ask for a sign-in link on your laptop and open it on your phone, or the other way around. It no longer has to be opened in the browser you asked from, and each link still works only once.",
    body: [
      "Until now the link in the sign-in email only worked in the browser where you asked for it, so opening it from your phone's mail app after asking on a laptop failed. It now works wherever you open it, and the invitation and password reset emails use the same kind of link.",
      "Like before, each link works once, and the code in the same email is still there if you would rather type it on the [sign-in page](/login).",
      "![The sign-in page, with a box for the code from your email](/changelog/sign-in-link-works-on-any-device/01-sign-in-code.webp)",
    ].join("\n\n"),
    image: { src: "/changelog/sign-in-link-works-on-any-device/01-sign-in-code.webp", alt: "The sign-in page, with a box for the code from your email" },
  },
  {
    slug: "staff-two-step-sign-in",
    date: "2026-11-18",
    audience: "staff",
    category: "new",
    title: "Two-step sign-in for the team",
    summary: "You can now add a code from an authenticator app to your sign-in. Once you have, the admin pages ask for that code, so a stolen sign-in link is not enough to get in.",
    body: `Open **Settings** and, on the Account tab, choose **Set up two-step sign-in**. Scan the picture with an authenticator app on your phone (or type the key shown under it), then enter the 6-digit code to turn it on. You can remove it there too.

![The set-up on the Settings page: a picture to scan, the key to type instead, and the box for the 6-digit code](/changelog/staff-two-step-sign-in/01-set-up.webp)

- **After you turn it on**, opening the admin pages asks for the code from your app the first time in each sign-in. Your member pages are not affected.
- **Until it is required of everyone**, a banner at the top of the admin pages reminds you to set it up. When the date is set, staff without it will be sent to the set-up screen first.
- **Lost your phone?** Ask the owner to reset it; the steps are in \`docs/STAFF_MFA.md\`.

![The screen that asks for your code the first time you open the admin pages in a sign-in](/changelog/staff-two-step-sign-in/02-enter-code.webp)`,
    image: { src: "/changelog/staff-two-step-sign-in/01-set-up.webp", alt: "The set-up on the Settings page: a picture to scan, the key to type instead, and the box for the 6-digit code" },
  },
  {
    slug: "database-roles-closed-by-default",
    date: "2026-11-17",
    audience: "engineering",
    category: "improved",
    title: "Database access is closed by default, and three tests keep it that way",
    summary: "The signed-out database role holds no table privileges, new tables start closed, and database tests now fail CI for a table without row level security or a caller-privileged function with no caller check.",
    body: `Row level security says which rows a role may see; grants say whether it may touch a table at all; a function that runs with its owner's rights can bypass both. Each layer now says no unless a migration says otherwise, and a test holds each one.

- **Grants.** The signed-out role has no privileges on any table in the app's schemas, and new tables start without any for it. A new table's migration grants \`authenticated\` and \`service_role\`, as before.
- **Row level security.** A test fails if any table in those schemas has it off.
- **Definer functions.** A test fails if a function that runs as its owner and that callers can execute has no recognizable caller check, does not pin its search path, or is runnable signed-out. A deliberate exception is one reviewed line in the test, with a reason, and a stale one fails too.
- **The limit.** The test proves a check exists, not that it is right. A person still reads every new definer function in its PR.
- **Detail.** \`docs/RLS_SECURITY.md\`, "Table privileges (grants)" and "Security definer functions".`,
  },
  {
    slug: "one-tooltip-component",
    date: "2026-11-17",
    audience: "engineering",
    category: "new",
    title: "One shared Tooltip for hints on controls",
    summary: "A hint on an icon button, a toggle or a disabled action is now one Tooltip component, so every hint looks the same and behaves well on touch and keyboard.",
    body: `Hints on controls used to be a mix of the browser's grey \`title\` box and hand-rolled CSS boxes, so two icons side by side could look different. \`components/Tooltip.tsx\` is now the one place that draws them.

- **Use it like this.** Wrap the one control: \`<Tooltip content="Pin to my dashboard"><button aria-label="Pin to my dashboard">...</button></Tooltip>\`. It adds no wrapper element, and \`content\` may be undefined for a conditional hint.
- **The behavior is built in.** Hover only on devices that hover, a long press on touch (that press doesn't click the control), keyboard focus shows it (not a tap), a short delay, Escape hides it, it stays while the pointer is over it, and it is linked with \`aria-describedby\`. It is drawn on the page body, so no scrolling card or modal clips it.
- **A hint is never the only place something lives.** The control keeps its own name; touch users don't see the tip.
- **Guarded.** Every native \`title\` tooltip in the app has moved over, and a new one fails \`tests/lib/tooltip-native-title.test.ts\` (iframe, abbr and pattern-input titles are the only exceptions). Rule: \`.claude/rules/tooltips.md\`.`,
  },
  {
    slug: "keyboard-shortcuts",
    date: "2026-11-17",
    audience: "product",
    category: "new",
    title: "Use your computer keyboard to get around the Hub faster",
    summary: "On a computer, press ? to see all the keyboard shortcuts, starting with the page you are on. Arrow keys move through lists and tables, and Ctrl+Enter (Cmd+Enter on a Mac) saves a form in a dialog.",
    body: `On a computer, you can now do more without reaching for the mouse.

- **See every shortcut.** Press **?** (or choose Keyboard shortcuts in the help menu at the top) to open a panel beside the page. It shows the shortcuts for the page you are on first, then the ones that work everywhere, and you can search it.
- **Lists and tables.** Move between rows with the arrow keys (j and k also work), and press Enter to open one.
- **Search boxes that suggest people or items.** Use the up and down arrows, Enter to choose, and the Escape key to close the list.
- **Saving.** Press Ctrl+Enter (Cmd+Enter on a Mac) to save a form in a dialog.

![The keyboard shortcuts panel open beside the Members page](/changelog/keyboard-shortcuts/01-shortcuts-panel.webp)

Press **?** again, or the Escape key, to close the panel. These work on a computer with a keyboard and a mouse or trackpad. On a phone or tablet you will not see them.`,
    image: { src: "/changelog/keyboard-shortcuts/01-shortcuts-panel.webp", alt: "The keyboard shortcuts panel open beside the Members page" },
  },
  {
    slug: "compliance-and-security-for-staff",
    date: "2026-11-17",
    audience: "staff",
    category: "new",
    title: "Compliance, Privacy and Security detail pages for the team",
    summary: "Three new pages in the admin System group show, for every promise members read on the public Compliance, Privacy and Security pages, where it is enforced, when it was last checked and what is still open.",
    body: `Open **Compliance**, **Privacy** or **Security** in the admin sidebar (System) to see what members read on the public [Compliance](/compliance), [Privacy](/privacy) and [Security](/security) pages, with more behind each line. Privacy has one line per promise the page makes: asking first, the retention limits, who can read chat, break-glass access, and how a member asks to see or remove what we hold.

- **Where it is enforced.** The files, docs and tests that make the line true, so you can check it.
- **Last checked.** The date someone last compared the line with the code.
- **Still open.** What isn't finished or hasn't been reviewed yet, gathered at the top of each page and linked to its line.

![The admin Privacy page, with the list of what is still open at the top](/changelog/compliance-and-security-for-staff/01-privacy-detail.webp)

The pages hold nothing private: the repository is public, so they carry no names, keys or account details. If you change what the Hub does, change the matching line with it.`,
    image: { src: "/changelog/compliance-and-security-for-staff/01-privacy-detail.webp", alt: "The admin Privacy page, with the list of what is still open at the top" },
  },
  {
    slug: "security-page",
    date: "2026-11-17",
    audience: "product",
    category: "new",
    title: "See how the Hub looks after your information and which rules it follows",
    summary: "The footer now has three pages in plain words: Privacy says what we collect and who sees it, Security says how your information is protected, and Compliance says which rules we follow. Each line says whether it is finished.",
    body: `Three pages in the footer answer "what happens to my information?", one short line at a time. Each line says whether it is in place, handled by one of our providers, or still in progress.

- **[Privacy](/privacy).** What we collect, who can see it, how long we keep it, and your choices.
- **[Security](/security).** How your information is protected:
  - Everything between your browser and the Hub is encrypted, and so are stored data and backups. Details such as your chat connection are kept separately, also encrypted.
  - Joining is by invitation, a sign-in lasts an hour at a time and renews in the background, and staff can end a member's sessions if an account is at risk.
  - The database is backed up continuously and can be restored to any moment in the last 7 days.
  - Who can see what is decided by the database itself, not only by the page you are on.
  - If something looks wrong, the page says how to tell us.
- **[Compliance](/compliance).** The privacy rules we follow for members in the EU, the EEA and the UK and for everyone else, how card details are handled (they never reach the Hub: our payment provider handles them), the accessibility checks we run, and which parts our providers handle for us.

Where something isn't finished, the line says so.

![The top of the Security page, with its key to what each label means and the Encryption section](/changelog/security-page/01-security-page.webp)

![The top of the Compliance page, with its key to what each label means and the Privacy and data protection section](/changelog/security-page/02-compliance-page.webp)`,
    image: { src: "/changelog/security-page/01-security-page.webp", alt: "The top of the Security page, with its key to what each label means and the Encryption section" },
  },
  {
    slug: "table-keyboard-navigation",
    date: "2026-11-17",
    audience: "engineering",
    category: "new",
    title: "Keyboard row navigation for tables",
    summary: "Wrap a table and its pager in TableKeyboardNav and it answers j/k, arrows, Enter, Space and the page keys, with no key code of its own.",
    body: `Tables are navigated from the keyboard by \`components/TableKeyboardNav.tsx\` (logic in \`lib/hooks/useTableKeyboardNav.ts\`), driven from the DOM, so a table adopts it by wrapping its markup and pager, not by writing handlers.

- **Rows opt in by what they hold.** A link, or an element (or the row) marked \`data-row-primary\`, is what Enter opens; a checkbox is what Space toggles, and Shift+j/k extends the range. A row with one full-width cell, or marked \`data-kbd-skip\`, is not a row.
- **Focus model.** The region is one tab stop with a highlighted row (\`aria-activedescendant\`, a live announcement). With one table on the page and nothing focused, j/k start it Gmail style. The highlight returns to the first row on a page or sort change.
- **Stays out of the way.** Single letters are ignored while typing, with a dialog, menu or open combobox, and with Ctrl/Cmd/Alt held (\`lib/keyboard.ts\`, shared with the calendar's keys). A page with its own single-key shortcuts declares \`data-page-keys\`.
- **For the shortcut panel.** \`TABLE_KEYBOARD_SHORTCUTS\` lists the keys and labels. Hints use \`Kbd\`. Tables not yet wrapped are in \`docs/TODO.md\`.`,
  },
  {
    slug: "kbd-shortcut-hints",
    date: "2026-11-17",
    audience: "engineering",
    category: "new",
    title: "One shared component for keyboard-shortcut hints",
    summary: "A shared Kbd component draws shortcut keys as small caps next to the control that owns the shortcut, and only on devices with a keyboard.",
    body: `Shortcut hints used to be hand-rolled \`<kbd>\` tags. \`components/Kbd.tsx\` is now the one place that draws them.

- **Use it like this.** \`<Kbd keys={["mod", "K"]} />\` renders one cap per key. Names such as \`mod\`, \`shift\`, \`enter\`, \`esc\`, \`up\` and \`down\` are mapped; a single letter is upper-cased. \`mod\` is the Command key on Apple platforms and Ctrl elsewhere, read on the client with \`useSyncExternalStore\`, so the server render and hydration agree and the right key appears right after.
- **Decorative only.** It is \`aria-hidden\`. The control that owns a shortcut declares it with \`aria-keyshortcuts\`, which keeps the visible hint out of the button's accessible name.
- **Only where there is a keyboard.** It is hidden below \`sm\` and on devices without hover and a fine pointer, through the \`fine-pointer\` Tailwind variant in \`tailwind.config.ts\`. Use that variant for any other keyboard-only affordance.
- **Add a hint only for a shortcut that works.** Today: search (open, move, choose, close), the modal close button, sending a chat message, and the admin calendar's week links.`,
  },
  {
    slug: "reorder-your-goals",
    date: "2026-11-17",
    audience: "product",
    category: "new",
    title: "Put a project's goals in the order you like",
    summary: "On a project's page, drag a goal to where you want it, or use its ⋯ (three dots) menu to move it. The goals you star on your dashboard follow that order too.",
    body: `A project's goals no longer have to stay in the order you first made them. Put the one you care about most at the top.

- **Drag to move.** Each goal has a small grip (two lines) on its left. Press it and drag the goal where you want it, with a mouse or your finger. Swiping anywhere else still scrolls the page.
- **Prefer not to drag?** Use the **⋯** button on a goal and choose **Move to position** to jump straight to the place you want. On a keyboard, select the grip, press Space, use the arrow keys, then press Space again. On a computer, hover over the grip to see these steps.
- **Your dashboard shows them in this order.** Starred goals in **Writing Goals** stay grouped by project, in your project order, and within each project follow the order you chose.
- **Nothing changes until you move a goal.** After that, goals you add go to the bottom of the list.

![A project's page with a grip beside each goal and a three-dots menu on the right](/changelog/reorder-your-goals/01-goals-with-grips.webp)

Open a project from [your Projects page](/projects) to see its goals. Reordering needs two or more goals in that project.`,
    image: { src: "/changelog/reorder-your-goals/01-goals-with-grips.webp", alt: "A project's page with a grip beside each goal and a three-dots menu on the right" },
  },
  {
    slug: "goal-start-date-starting-count-note",
    date: "2026-11-16",
    audience: "product",
    category: "improved",
    title: "A goal with a start date now says when your starting words aren't counted",
    summary: "A goal with a start date counts only the words you log from that day on, so your project's starting word count (or another starting count) is left out. The goal now shows a note saying so.",
    body: `If you gave a project a starting word count (or another starting count) and then set a start date on its goal, the goal counts only what you log from that date on. It now shows a note under the progress bar, such as "Your starting 20,000 words aren't counted because this goal is for what you log in a specific time frame."

To count your starting words, clear the goal's start date. A goal without one counts everything on the project.`,
  },
  {
    slug: "reorder-your-projects",
    date: "2026-11-16",
    audience: "product",
    category: "new",
    title: "Put your writing projects in the order you like",
    summary: "On your Projects page, drag your projects into the order you want, or use a project's ⋯ (three dots) menu to move it. The goals you star on your dashboard follow the same order.",
    body: `Your projects no longer have to stay newest first. Put the one you are working on right now at the top, and the ones you are saving for later below it.

- **Drag the handle.** Each project has a small grip (two lines) next to its ⋯ menu button. Press it and drag the project to where you want it, with a mouse or your finger. Swiping anywhere else on the card still scrolls the page.
- **Prefer not to drag?** Use the **⋯** button on a project and choose **Move to position** to jump straight to the place you want. On a keyboard, select the grip, press Space, use the arrow keys, then press Space again. On a computer, hover over the grip to see these steps.
- **Your dashboard follows.** The goals you have starred in **Writing Goals** on your dashboard are shown in the same order as their projects, so moving a project moves its goals too.
- **Nothing changes until you do.** Your projects stay as they are today until you move one. A project you create later appears at the top, and projects you have put on hold are not affected.

![The Projects page, with a grip and a reorder button on each project](/changelog/reorder-your-projects/01-projects-with-grips.webp)

Find it on [your Projects page](/projects) once you have two or more projects.`,
    image: { src: "/changelog/reorder-your-projects/01-projects-with-grips.webp", alt: "The Projects page, with a grip and a reorder button on each project" },
  },
  {
    slug: "checkin-dm-closes-on-answer",
    date: "2026-11-16",
    audience: "engineering",
    category: "improved",
    title: "A check-in answered in the Hub closes its Slack DM and clears the unread badge",
    summary: "When a member answers or skips a check-in or check-out in the Hub, the bot's Slack message collapses to the closed note, and for members who connected Slack it is marked read as them.",
    body: `Answering a prickle check-in or check-out in the Hub used to leave the bot's Slack message live, with stale answers and an unread badge.

- **Remember the message.** When a check-in or check-out DM is sent, the channel adapter now returns where the message landed, and the sender keeps it on the DM's dedup log row. \`notifier.send\` takes an \`onReceipt\` callback for this; any feature that edits its own Slack message later can use it the same way.
- **One function closes it.** \`closeCheckinDms\` runs after the response from every Hub path that answers or dismisses a half. It collapses the DM with the bot token, then, for members whose Slack connection has the DM scopes, moves their read marker to that message (never backward). It is idempotent, production only, and a Slack failure is logged and never costs the answer.
- **Slack's own buttons are untouched.** Submit and Skip in Slack already collapse the message, so they don't call it.
- **Old DMs are skipped.** Ones sent before the message was kept have nothing to find; the live path never searches history.

Detail: "Read state shared with Slack" in \`docs/SLACK_BRIDGED_CHAT.md\`.`,
  },
  {
    slug: "lesson-comments-notifications",
    date: "2026-11-16",
    audience: "engineering",
    category: "new",
    title: "Lesson comments: follows, reply notifications and a daily digest, in dry run first",
    summary: "Members follow a lesson's comments, hear about replies and instructors' answers, and get one daily note about new comments; staff get a daily note while reported or held comments wait. All of it logs instead of sending until its flag is on for them.",
    body: `Notifications for lesson comments, on the same notifier as everything else the app sends.

- **Four registry kinds.** Replies to your comment, instructor replies, a daily digest of followed lessons, and a staff note about the review queue (a kind marked \`staffOnly\`, shown in settings only to admins). Each has a sample message and an email template, and a message links to the exact comment (\`?comment=\`, which the thread scrolls to and marks) and carries no comment text.
- **Follows and read markers** are two small tables behind the comment repository. Posting follows the lesson unless the member already chose; opening the thread records the visit, which gives "N new since your last visit" and marks the thread's in-app notifications read.
- **Replies go out as they happen**, after the response, claimed per comment so a retry or a staff approval of a held reply never sends twice. The digests run once a day from a cron route, claimed per member and Eastern day; the digest starts where the last real run ended.
- **A new automated sender starts in dry run.** The \`lesson_comment_notifications\` flag decides who is told for real; for everyone else the sender logs the member, kind, why, channels and message, and writes no claim or run mark, so switching it on starts clean. A member with no reachable channel never uses a claim, and a member whose access ended is never told.

Detail: "Phase 3 (notifications), as built" in \`docs/COURSES.md\`.`,
  },
  {
    slug: "lesson-comments-moderation",
    date: "2026-11-16",
    audience: "engineering",
    category: "new",
    title: "Lesson comments: reports, held links and staff moderation, one audit entry per action",
    summary: "Members can report a comment, a comment with more than two links waits for staff, and staff hide, delete, approve or dismiss from a moderation page. Each staff action writes one audit entry without the comment's text. Still behind the lesson comments flag.",
    body: `Moderation for lesson comments builds on the thread, behind the same flag.

- **One function, one entry.** Staff actions call a database function that checks the caller is an admin, changes the comment, settles its reports and writes a single audit entry as that admin (who, which comment, the lesson's title, before and after). The table has no row-level audit trigger because that would copy every comment's text into the log; the entry never holds text either. It follows "Record the intent, not the noise" in \`docs/ACTIVITY_AND_AUDIT_LOG.md\`.
- **Visibility is enforced twice.** A held comment is its author's and staff's alone, and a hidden one is a tombstone for members, both in the row-level policy and in the repository's \`threadFor(lessonId, viewer)\`.
- **The link rule is one helper** (\`shouldHoldComment\`), counting links the way the thread auto-links them. There is no word filter.
- **Reports** have their own table, one open report per reporter and comment, readable by admins only; the author is never told who reported.
- **Admin pages** are tabs by path (Unanswered questions, Moderation), admin only.

Detail: "Phase 2 (moderation), as built" in \`docs/COURSES.md\`.`,
  },
  {
    slug: "landing-page-build-with-ai",
    date: "2026-11-16",
    audience: "staff",
    category: "new",
    title: "Build and change landing pages by describing them",
    summary: "Describe a page on New page and get a draft, or open the AI tab in the editor to add blocks or change the page with a sentence. Nothing goes live until you publish.",
    body: "On New page, type who the page is for, what you offer, and any dates, prices and links, then choose Draft the page. It can take a minute, and the draft opens in the editor.\n\nIn the editor, the AI tab sits beside Blocks and Outline. Add writes new blocks at the end of the page. Change edits the page you have: ask for a shorter intro, an FAQ, outline buttons. Pictures and anything you didn't mention stay as they are, and Undo brings the old page back.\n\nThe assistant only uses what you wrote. Where it lacks a fact it writes around it and leaves a button's link empty, so the publish check stops you until you fill it in. Check every fact and link before you publish. It does not add pictures, testimonials, countdowns, videos or sign-up forms, because it cannot know the right ones: add those in the editor.\n\nWhat is sent to the Claude API: your description, and in Change mode the page's text and settings (no pictures, no member data).",
  },
  {
    slug: "landing-page-kajabi-import",
    date: "2026-11-16",
    audience: "engineering",
    category: "new",
    title: "Import a Kajabi page export as a draft landing page",
    summary: "Pages has an Import from Kajabi item beside New page: upload a Kajabi page export (zip) and get an unpublished draft built from our blocks, with a report of what was approximated or left out. Importing the same page again replaces only its draft.",
    body: `Kajabi has no content API, but its page export is structured (sections with typed blocks and their settings), so the move is a mapping and not a model.

- **Deterministic mapper.** \`mapKajabiPage\` (\`lib/landing/kajabi-import.ts\`) is a pure function from the export's settings to Puck JSON: text becomes headings, dividers and cleaned rich text, call-to-action blocks become buttons, forms become the sign-up block, the header logo and footer copyright come across. Whatever has no counterpart is returned as a note (approximated, left out, hidden in Kajabi, still to do) and shown on a results screen. No AI, no new dependency.
- **Untrusted upload.** The zip is read in memory by \`readKajabiZip\`: only the settings file and the images are inflated, each counted as it unpacks against size limits, with path and entry-count checks. Pictures go to the media library, private until a page that shows them is published. Everything passes the same sanitiser as any save.
- **Idempotent and safe on live pages.** The export has no page id, so a key is derived from ids it does carry; the same page imported again replaces only the draft (never the published copy or versions), asks first when the draft holds edits the import would lose, and keeps the old draft in the page's history as a "before import" version you can bring back.
- **Extension point.** A new Kajabi block type is one more branch in the mapper and a test.

How to use it, what is not handled and the model: "Importing from Kajabi" in \`docs/LANDING_PAGES.md\`.`,
  },
  {
    slug: "landing-page-builder",
    date: "2026-11-15",
    audience: "engineering",
    category: "new",
    title: "A page builder for landing pages, on Puck, with drafts, publishing and history",
    summary: "Admins build landing pages from blocks at Pages, see them on a phone, tablet and desktop as they edit, and publish them as a separate, explicit step. Published pages are public at /p/<address>.",
    body: "Kajabi's landing pages are moving into the Hub. A page is Puck's JSON, edited in a shell of ours and rendered by the same blocks in the editor and on the public route, so the preview is the page. Autosave writes only the draft; publishing runs accessibility checks, keeps a version and makes the page's pictures public, so an edit never goes live by accident and an earlier version can be brought back.\n\nThe rules to follow: a page's id never appears in a URL (the address is the slug); rich text is cleaned to an allowlist on save and again before every public render; props named `*AssetId`, `href`, `url` and `html` are picture ids, links and rich text everywhere, so one set of helpers covers any block; only a signed-in admin reads the tables, and the public route reads published pages with the service role. A block is a component, its defaults and its fields, with container-query layout. Sign-up forms are a block too: the browser posts to a relay that forwards to Kajabi through an `OptInDestination`, stores nothing, and only forwards to a form the published page shows. How to add a block, the model and the checks: `docs/LANDING_PAGES.md`.",
  },
  {
    slug: "lesson-comments-foundation",
    date: "2026-11-15",
    audience: "engineering",
    category: "improved",
    title: "Lesson comments: the thread, behind a flag",
    summary: "Course lessons can carry a comment thread: a repository for it, access rules in the database, and a shared thread component. It is off for everyone until the flag is switched on.",
    body: `Members with access to a course can ask questions under an open lesson, and staff answer where they were asked. Everything is behind the \`lesson_comments\` flag.

- **Data.** One repository (\`CourseCommentRepository\`, with an in-memory twin) owns the queries and builds the thread: questions newest first, replies oldest first, a "Comment removed" placeholder only when replies hang under it. Access follows the lesson: current course access, lesson open, and read-only while an admin previews as a member. The database also enforces the one-level threading and the 15-minute edit window, so a direct client can't get around the actions.
- **Writes.** Server actions check the flag, the lesson, sudo and rate limits, and keep the text out of analytics and logs.
- **UI.** \`CommentThread\` renders plain text and links only http(s) addresses.

Moderation, notifications and the Kajabi import are later phases: see "Lesson comments" in \`docs/COURSES.md\`.`,
  },
  {
    slug: "course-video-playback-quality-in-mux-data",
    date: "2026-11-15",
    audience: "engineering",
    category: "new",
    title: "Playback quality of course videos is measured in Mux Data, for the lesson page, chat and the course builder",
    summary: "Every place that plays a course video now reports how it played (start time, buffering, errors) to Mux Data, under a player name per place, so a failing video can be told apart from a wrong setting.",
    body: "Playback failures used to be visible only as our own alerts, which say that a video failed but not why. Mux Data adds the player's own view: start time, rebuffering, errors and watch time per view, with the page it happened on.\n\nThe one player (`LessonPlayer`) takes a `surface` (`PlayerSurface` in `lib/mux-data.ts`), and each reports under its own name in the Mux dashboard: Hub Course player, Hub Course Builder player and Hub Chat player. A new place that plays a lesson video passes the viewer's consent facts from `muxDataConsentFor` and its own surface.\n\nIt is anonymous (no member id, name or email; cookies off), and it follows the usage-statistics consent: the banner's Accept where one is needed, never after \"Leave me out of statistics\", never in sudo. It ran behind a flag while it was checked against production, and is now on for everyone; there is no switch. Detail and the consent rule: `docs/MUX_CONFIG.md`, \"Mux Data\".",
  },
  {
    slug: "answer-check-ins-in-hub-chat",
    date: "2026-11-15",
    audience: "product",
    category: "new",
    title: "Answer your check-in and check-out in Hub Chat",
    summary: "When Billie Bot, our Slack helper, sends you a check-in or check-out, you can now answer it in Hub Chat as well as in Slack. Your answers are saved to your check-in for that prickle.",
    body: [
      "Billie Bot's check-in and check-out messages now work in Hub Chat. Pick a number on each scale, choose a feeling from the list, say what you need, and type how much you wrote and press Enter. Then tap Submit or Skip.",
      "![Billie Bot's check-in in Hub Chat, with scales to tap, a feeling and an intention to pick, and Submit and Skip check-in buttons](/changelog/answer-check-ins-in-hub-chat/01-check-in-controls.webp)",
      "It works the same as the buttons in Slack: your answers go to your check-in for that prickle, and the message in Slack updates to show them. Links in these messages, and bold titles, now look the way they do in Slack.",
    ].join("\n\n"),
    image: { src: "/changelog/answer-check-ins-in-hub-chat/01-check-in-controls.webp", alt: "Billie Bot's check-in in Hub Chat, with scales to tap, a feeling and an intention to pick, and Submit and Skip check-in buttons" },
  },
  {
    slug: "block-link-previews-in-hub-chat",
    date: "2026-11-15",
    audience: "product",
    category: "improved",
    title: "Choose which sites show a preview in Hub Chat",
    summary: "When you remove the preview that appears when you share a link, you can also block previews from that whole website, from one part of it, or from just that link. This applies to messages you write from now on.",
    body: [
      "The X on a preview now asks \"Remove preview?\" before it goes. Leave the box ticked to also block previews like it, then pick how much to block.",
      "![The Remove preview question in Hub Chat, with a ticked box to also block previews from the website and a choice of how much to block](/changelog/block-link-previews-in-hub-chat/01-remove-preview.webp)",
      [
        "- **A whole website, one part of it, or just that link.** You choose one before you confirm.",
        "- **Only your own messages, from now on.** Previews already in a conversation stay as they are, and other people's messages are not affected.",
        "- **If every link in a message is blocked, Slack doesn't show a preview for it either.**",
        "- **Change your mind any time** in Settings, under Preferences: your blocked sites are listed there, each with a button to stop blocking it.",
        "- **Untick the box** to remove just that one preview, as before.",
      ].join("\n"),
      "![Your blocked sites in Settings, under Preferences, each with a Stop blocking button](/changelog/block-link-previews-in-hub-chat/01-blocked-sites.webp)",
    ].join("\n\n"),
    image: { src: "/changelog/block-link-previews-in-hub-chat/01-remove-preview.webp", alt: "The Remove preview question in Hub Chat, with a ticked box to also block previews from the website and a choice of how much to block" },
  },
  {
    slug: "stripe-invoices-and-charges-in-bronze",
    date: "2026-11-13",
    audience: "engineering",
    category: "new",
    title: "Stripe invoices and charges are imported, so the Hub can say who was billed what and when",
    summary: "Bronze now keeps Stripe's invoices and charges (amounts, status, period, paid date, failure code), pulled nightly and by the manual Stripe import, together with Stripe's customers, products and subscriptions.",
    body: "Subscriptions say what a member has, not what they were charged, so paid months, failed payments and whether a paused member was billed could not be answered. The import is pull-based and idempotent: the first run reads the whole history, later runs read since the newest stored row minus a safety window and ask again about invoices still open or draft. It keeps only what the Hub needs (cents, instants, statuses, ids), never the raw record, card details, customer email or name, or Stripe's free-text failure message, and the tables are service role only.\n\nRead through `BillingRepository`. A key that may not read invoices or charges is reported as such in the import result. Detail: `lib/stripe/billing-import.ts` and `docs/TODO.md`, \"Import Stripe invoices and charges as Bronze data\".",
  },
  {
    slug: "slack-activity-names-who-is-in-each-dm",
    date: "2026-11-13",
    audience: "staff",
    category: "fixed",
    title: "A member's Slack Activity tab says who is in each DM and group DM",
    summary: "Direct and group message rows now read \"DM: Ada\" or \"Group: Ada, Bram +1\" instead of a bare label, so you can tell conversations apart.",
    body: [
      "On a member's page, the Slack Activity tab used to show every private conversation as the same \"Direct message\" or \"Group message\". Each row now names the other people in it: one name for a DM, two names and a count for a group (\"Group: Ada, Bram +2\"). The member whose page it is is left out, unless nobody else is in the conversation.",
      "![A member's Slack Activity tab, with rows reading DM and Group followed by the other people's names](/changelog/slack-activity-names-who-is-in-each-dm/01-slack-activity.webp)",
      "It reads who is in the conversation, never what was said. That matches what /privacy tells members: staff can see who is in every conversation, and message text stays closed.",
      "Private conversations Billie Bot cannot see into no longer raise the \"lost access\" alert, so the Slack hygiene page lists only real channels.",
    ].join("\n\n"),
    image: { src: "/changelog/slack-activity-names-who-is-in-each-dm/01-slack-activity.webp", alt: "A member's Slack Activity tab, with rows reading DM and Group followed by the other people's names" },
  },
  {
    slug: "members-processing-links-the-stripe-customer-with-the-subscription",
    date: "2026-11-13",
    audience: "engineering",
    category: "fixed",
    title: "When several Stripe customers share an email, the member links to the one that holds the live subscription",
    summary: "Members processing used to link whichever matching Stripe customer it read last. It now prefers a customer with a live subscription.",
    body: "Stripe can hold several customers for one person's email. Linking the last one read meant a member could point at a newer, empty customer while their live subscription sat on an older one, and the link was rewritten on every run.\n\nThe choice is now one pure helper in `lib/stripe-customer-link.ts`: a customer with a live subscription first (active, trialing, past due, any product), then any subscription, then the newest, with a tie-break that does not depend on the order rows arrive in. Subscriptions are loaded with the other reference data through `BillingRepository`. Any new code that must pick one customer for a member should call the helper rather than take the first match. Several customers per member remain a known limit, tracked in `docs/TODO.md`.",
  },
  {
    slug: "mark-unread-in-hub-chat",
    date: "2026-11-13",
    audience: "product",
    category: "improved",
    title: "Mark a message unread in Hub Chat",
    summary: "Not ready to answer yet? Choose Mark unread on a message, and it and everything after it show as unread again until you come back.",
    body: [
      "Open the three dots on a message and choose **Mark unread**. That message and everything after it counts as new again: the conversation shows its number in the sidebar, and the next time you open it the \"New\" line sits above that message and you land right there.",
      "![A message's More actions menu in Hub Chat, with Mark unread at the top](/changelog/mark-unread-in-hub-chat/01-mark-unread-menu.webp)",
      "The conversation stays unread while you're in it and when you leave, so you can read on and still find your place later. It only marks your own view, so nobody else sees a change.",
      "If you've connected Slack, the message looks unread there too.",
    ].join("\n\n"),
    image: { src: "/changelog/mark-unread-in-hub-chat/01-mark-unread-menu.webp", alt: "A message's More actions menu in Hub Chat, with Mark unread at the top" },
  },
  {
    slug: "more-than-one-zoom-account",
    date: "2026-11-12",
    audience: "engineering",
    category: "new",
    title: "More than one Zoom account: imports, webhooks and a keep-or-ignore rule for the extra ones",
    summary: "The Hub can import meetings from several Zoom accounts. A secondary account's meetings stay in Bronze but reach prickles and attendance only once an admin keeps them.",
    body: [
      "Each account is a row with a default (keep or exclude) and the prefix of its credentials. The import and the nightly reconcile cover every account and skip one whose credentials are not set; the webhook accepts the secret of any configured account and records which one it came from. Bronze rows carry their account.",
      "Exclusion is applied when Silver is read, in the Zoom repository: an instance decision beats a link's, which beats the account default, and the same function serves the twin and the review page. Reprocessing then adds or removes the prickle and attendance, so a changed decision is fully reproducible. Admins decide on Health Check, Zoom Meetings.",
      "**For a new Zoom read:** go through `ZoomRepository` so the rule applies; don't read the Bronze tables directly. Detail and the owner's setup steps: `docs/ZOOM_ACCOUNTS.md`.",
    ].join("\n\n"),
  },
  {
    slug: "chat-cards-for-hub-links",
    date: "2026-11-12",
    audience: "engineering",
    category: "new",
    title: "Links to Hub pages in chat are drawn as cards, decided for each reader",
    summary: "A link to a chat message, a prickle or a member's profile in Hub Chat is drawn as a card built for whoever is reading it, instead of the sign-in page Slack previews. It is behind a feature flag.",
    body: "Hub pages sit behind sign-in, so a link preview made by the Hub's page reader or by Slack's crawler could only ever show the login page. The card is requested when it appears, and every read is made as the reader, so row-level security applies the rule of the page the link goes to. A quoted message shows its text only to someone who can read it, and anything a reader may not see comes back as the same neutral \"Link to the Hub\" as a message that does not exist. The author can remove the card with the same X as other previews.\n\nWhen a card applies, Slack's preview of that link is left out. The decision is per reader and behind a feature flag, so with the flag off a message looks as before. To add a kind of link, give `parseHubLink` its address shape and `loadHubLinkCard` its case; steps are in `docs/SLACK_BRIDGED_CHAT.md`, \"Hub links\".",
  },
  {
    slug: "chat-new-messages-banner",
    date: "2026-11-13",
    audience: "product",
    category: "improved",
    title: "Hub Chat tells you how many new messages are waiting above",
    summary: "When a conversation has more new messages than fit on screen, a small label at the top tells you how many there are. Tap it to jump back to where the new ones start.",
    body: [
      "If you open a conversation with a lot of unread messages and scroll away from the \"New\" line, a small label appears at the top saying, for example, \"↑ 13 new messages\".",
      "![A conversation in Hub Chat with a small label at the top reading 5 new messages](/changelog/chat-new-messages-banner/01-new-messages-pill.webp)",
      "- **Tap it** to scroll back up to the \"New\" line.",
      "- **Tap the ✕** to hide it until you open the conversation again.",
      "- It goes away by itself once the \"New\" line is on screen. The number is every message from the \"New\" line down, including any you wrote yourself, counted when you opened the conversation. It doesn't change as more messages arrive.",
    ].join("\n\n"),
    image: { src: "/changelog/chat-new-messages-banner/01-new-messages-pill.webp", alt: "A conversation in Hub Chat with a small label at the top reading 5 new messages" },
  },
  {
    slug: "direct-messages-in-hub-chat",
    date: "2026-11-12",
    audience: "product",
    category: "new",
    major: true,
    title: "Your Slack direct messages, in Hub Chat",
    summary: "Read and reply to your Slack direct messages and group messages without leaving the Hub. Every conversation sits in one sidebar: channels, group messages and direct messages.",
    image: { src: "/changelog/direct-messages-in-hub-chat/01-direct-message.webp", alt: "Hub Chat with the sidebar showing Channels, Group messages and Direct messages, and a direct message open beside it" },
    body: [
      "Your Slack direct messages and group messages now show up in Hub Chat, so one place holds all your conversations. Reply there and your message goes to Slack under your name.",
      "![Hub Chat's sidebar with Channels, Group messages and Direct messages, and a direct message open](/changelog/direct-messages-in-hub-chat/01-direct-message.webp)",
      "- **Everything in one sidebar.** Public channels, group messages and one-on-one direct messages each have their own heading.",
      "- **Start one from a profile.** Press **Message** on a member's profile to open your Slack conversation with her, or start a new one. If she hasn't connected Slack, the Hub tells you it can't open one.",
      "- **Write the way you do in channels.** Files, reactions, replies under a message, edits and deleting your own messages all work, and they stay up to date in both places.",
      "![A group message in Hub Chat](/changelog/direct-messages-in-hub-chat/02-group-message.webp)",
      "To use it, your Slack account needs to be connected in Settings. If you connected it before this, Settings and Hub Chat show a **Reconnect Slack** bar: reconnect once so the Hub can read and send your direct messages as you.",
      "These stay private. The other person in a conversation sees it in their own Hub Chat once they've connected Slack, and Quill & Cup staff can see that a conversation exists, who is in it, who wrote and when, but not what it says, except through break-glass access, the same as for a restricted channel. When an admin views the Hub as you, your direct messages are not shown.",
      "The Hub keeps its own copy of your direct messages, and Slack only shows about 90 days of history on our plan, so the Hub's copy stays until you ask us to remove it. There is no separate switch for direct messages: to stop the Hub reading them, disconnect Slack in Settings, and Hub Chat closes until you reconnect. The details are on the [privacy page](/privacy).",
    ].join("\n\n"),
  },
  {
    slug: "lesson-videos-in-chat",
    date: "2026-11-12",
    audience: "product",
    category: "new",
    major: true,
    title: "Watch a course lesson right in Hub Chat",
    summary: "Share a lesson's video in any conversation and everyone who has the course can watch it right there. It's the first thing in the Hub that works only in Hub Chat, because Slack can't remember where you stopped or mark your lesson complete.",
    image: { src: "/changelog/lesson-videos-in-chat/01-video-card.webp", alt: "A conversation in Hub Chat with a lesson video shown as a picture you press to play" },
    body: [
      "A lesson's video can now sit inside a chat message, as a picture you press once to play. It works in channels, in replies under a message, and in private messages.",
      "We've wanted this for years. Slack never let us do it well: it can't keep track of what you've watched, pick a long video back up where you left off, or mark the lesson complete when you finish. Hub Chat can do all three, so this is the first feature that works only in Hub Chat. If you mostly chat in Slack, this is a good reason to try the same conversation here.",
      "- On a lesson, choose **Copy link** under the video and paste it into any message in Hub Chat or in Slack. It plays in Hub Chat; Slack shows links back to the Hub.",
      "- It shows the lesson, its course and its picture. If you have the course, it plays right in the message, from where you left off, and the lesson is marked complete once you've watched nearly all of it; if not, it says the video is part of a course and nothing plays.",
      "![A lesson video shared in a conversation](/changelog/lesson-videos-in-chat/01-video-card.webp)",
      "![A lesson video that has been watched, with its lesson marked complete](/changelog/lesson-videos-in-chat/01-lesson-complete.webp)",
      "![What someone without the course sees](/changelog/lesson-videos-in-chat/01-no-course.webp)",
      "- In Slack, if you've connected your Slack account, the message you pasted is changed, under your name, to say what was shared, with links to watch it in Hub Chat or open the lesson. Slack shows it as edited.",
      "- Delete the message and the video is gone from the conversation right away.",
      "Watching a video in chat records where you stopped and which parts you watched, as it does on the lesson page. Quill & Cup admins can see this in the course statistics. Other members can't.",
    ].join("\n"),
  },
  {
    slug: "link-previews-in-hub-chat",
    date: "2026-11-12",
    audience: "product",
    category: "new",
    title: "Links in Hub Chat show a preview",
    image: {
      src: "/changelog/link-previews-in-hub-chat/01-preview-card.webp",
      alt: "A Hub Chat message with a link and its preview card: site name, title, a short description and a picture of a lighthouse.",
    },
    summary: "When you paste a link into a Hub Chat message, a preview card appears with the page's title, a short description and a picture. A link to an image shows the image, and people reading in Slack see a preview too.",
    body: [
      "Paste a link and the preview appears right under your message.\n\n![A Hub Chat message with a link and the preview card under it: the site name, title, a short description and a picture, with the X beside it that only the message's author sees.](/changelog/link-previews-in-hub-chat/01-preview-card.webp)",
      [
        "- **People reading in Slack see a preview too.**",
        "- **Previews Slack makes also show in Hub Chat.** When someone pastes a link in Slack, its preview appears here as well.",
        "- **Only the person who wrote a message can remove its preview with the X** in the corner of the card in Hub Chat. On a message written in Hub Chat, a preview removed here also disappears in Slack, and one removed in Slack also disappears here, right away.",
        "- **A Slack message shared into a conversation shows in Hub Chat as a quoted message** with a link to the original, and the person who shared it can remove it with the X like any preview.",
        "- **Only people who can read a message see its previews**, and the pictures in them load through the Hub, so the site a link points to doesn't see who looked.",
      ].join("\n"),
      "Previews are made when you send a message, for the first three links in it. Some sites don't offer one, and then the link stays a plain link.",
    ].join("\n\n"),
  },
  {
    slug: "duplicate-course",
    date: "2026-11-12",
    audience: "staff",
    category: "new",
    title: "Duplicate a course to try the course editor on a copy",
    summary: "On any course's admin page, Duplicate course makes a draft copy you can edit in the Hub while the real course stays as it is in Kajabi.",
    body: [
      "Open a course in Admin, Courses and press **Duplicate course** (it is there for courses imported from Kajabi and for courses made in the Hub). The dialog says what is copied first. You land on the new course, called \"<name> (copy)\".",
      [
        "- **Copied:** the modules, submodules and lessons in the same order, with their text, pictures and downloads. Videos are not uploaded again: the lessons play the same videos as the original.",
        "- **Not copied:** members' access and progress, comments, and the link to a program (link it yourself when the copy is ready).",
        "- **A draft:** the copy and every module and lesson in it start as drafts, so members cannot see it until you publish it.",
        "- **Kajabi never touches it:** the real course keeps syncing as before; the copy is yours to change. The duplicate lesson and duplicate module buttons in the outline now copy downloads too.",
      ].join("\n"),
      "The audit log records one entry for the new course, saying which course it was copied from.",
    ].join("\n\n"),
  },
  {
    slug: "course-address-redirects",
    date: "2026-11-12",
    audience: "staff",
    category: "improved",
    title: "Change a course's address without breaking the links people have",
    summary: "When you rename a course, the course details offer the matching new address in one click, and a course that is or was published keeps its old addresses working.",
    body: [
      "This is for courses made in the Hub, in Admin, Courses. Courses imported from Kajabi keep the address Kajabi gives them.",
      [
        "- **A suggestion when you rename:** if the address was just following the name, a \"Use <new address>\" button appears under it. It is a suggestion, so nothing changes until you press it. A copy made with Duplicate course has a placeholder address ending in \"-copy\"; once you take \"(copy)\" out of the name, the button offers the real one.",
        "- **Old links keep working:** if the course is published, or ever was, changing its address sends anyone who opens the old address (a course, a lesson, a module or a download) to the new one, including links shared in messages. A course that was never published can change its address freely, and nothing is kept.",
        "- **An old address stays taken:** another course cannot use an address an earlier course still redirects from, and the form says so. If you change a course back to an address it had before, that address is the course's own again.",
      ].join("\n"),
      "Someone who isn't signed in and follows an old address of a course that isn't public sees the sign-in page, the same as for the current address. The audit log records the rename as one change to the course.",
    ].join("\n\n"),
  },
  {
    slug: "where-pictures-come-from",
    date: "2026-11-12",
    audience: "engineering",
    category: "improved",
    title: "Where pictures come from: the picture proxy, the media library, and the hosts we load directly",
    summary: "Pictures under chat messages are fetched by the Hub, our own uploads are served by the media library, and a few trusted hosts such as Gravatar and Slack's profile pictures are loaded directly. This entry says which is which, and why.",
    body: "Which path a picture takes depends on who controls its address.\n\n- **An address someone else chose** (a link preview, an app's card or logo): the picture proxy.\n- **Our own uploads** (book covers and other library images): the media library, served from the original in private storage (`docs/MEDIA_LIBRARY.md`).\n- **Member profile photos:** rebuilt by member processing from Kajabi, then Slack, then Gravatar; a photo that must outlast its source is kept in our storage.\n- **Loaded directly, on purpose:** Gravatar, Slack's profile pictures for people not matched to a member, Mux stills, Google profile photos and analytics beacons. These are the hosts in `csp.imageHosts` in `app.config.ts`, which is also what the policy allows.\n\n**For a new feature:** an address from a user or a message goes through the proxy; our own uploads go through the media library; a vendor picture of a known person may load directly if its host is added to `csp.imageHosts`. Never take an address from a query string.",
  },
  {
    slug: "lesson-videos-in-chat-building-blocks",
    date: "2026-11-11",
    audience: "engineering",
    category: "new",
    title: "Lesson videos in chat messages: the pieces behind the flag",
    summary: "A chat message can share a course lesson's video, played in the message with the course's rules, from Hub Chat or a link pasted in Slack. It is behind a feature flag.",
    body: "A chat message can share one course lesson's video. The share and its message are written together by a checked database function, and a repository (`ChatVideoRepository`) points one message at one lesson. Playback links are minted per viewer, after two checks: the viewer can read the message (read as them, so row-level security applies the channel rule) and may watch the lesson (`mayWatchSharedVideo`). Watching goes through the lesson player, tagged with the message so course stats keep chat views apart.\n\nA pasted lesson address becomes the card in Hub Chat (`extractLessonLink`) and in a message written in Slack (webhook, and the nightly chat import for what it missed). The Slack copy is then rewritten as its author through their own connected account (`rewriteInSlack`), and Hub Chat hides the link line and Slack's own preview (`stripSharedVideoLink`, `withoutLessonPreview`). Deleting a message ends its share at once.\n\nThe sign-in and connect-Slack detours use the gates standard (`lib/gates.ts`): the destination is carried through every step and each gate page offers \"Not now\". Detail: `docs/CHAT_VIDEOS_LAUNCH.md` and `docs/SLACK_BRIDGED_CHAT.md`, \"Lesson videos in messages\".",
  },
  {
    slug: "event-places-left-and-sign-up",
    date: "2026-11-11",
    audience: "product",
    category: "improved",
    title: "See how many places are left on an event, and sign up from its page",
    image: { src: "/changelog/event-places-left-and-sign-up/01-events-list.webp", alt: "The Events page: the Winter Writing Retreat card says 12 places left" },
    summary: "Events with limited places now show how many are left, or \"Sold out!\" when they are full. If you can buy a ticket, the event page has a Sign up button.",
    body: [
      "On the Events page, an event with limited places shows how many are left, or \"Sold out!\" when none are.",
      "![The Events page: the Winter Writing Retreat card says 12 places left](/changelog/event-places-left-and-sign-up/01-events-list.webp)",
      "Open the event and you will see the same, with a **Sign up** button that takes you to the ticket page. When it is sold out, the button goes away.",
      "![The retreat's page: the sign-up requirement, 12 of 12 places left, and a Sign up button](/changelog/event-places-left-and-sign-up/02-event-page.webp)",
      "Places count both tickets already bought and people already on the list, so the last place shows as taken as soon as it is paid for.",
    ].join("\n\n"),
  },
  {
    slug: "sync-segments-from-course-program-event",
    date: "2026-11-11",
    audience: "engineering",
    category: "new",
    title: "Previews: fill a segment from the people with access to a course, program or event",
    summary: "The segment dialog on the Previews page can add everyone with access to a course, program or event to a segment, so a feature flag linked to that segment reaches them.",
    body: "In a segment's Manage dialog, pick a course, program or event and press Sync (`POST /api/admin/segments/[id]/sync`, choices from `GET /api/admin/segments/sources`). It only adds: members already in the segment stay, and running it again picks up whoever got access since. It does not run on its own.\n\nWho counts is read in `lib/segment-sources.ts`: members whose course access has started and not ended, anyone enrolled in any cohort of a program, an event's attendees. A feature flag still reaches people through the existing flag-to-segment link, so there is no schema change.",
  },
  // The date is the launch day: the first care plan in production was created on 2026-11-12 (Eastern), read from `care_engagements` on 2026-11-18.
  {
    slug: "hedgie-care",
    date: "2026-11-12",
    audience: "staff",
    category: "new",
    title: "Hedgie Care: keep track of your reach-outs to members, and see how they went",
    summary: "Hedgie Care is where the community manager keeps her reach-outs to members: one care plan for each stretch of time, who spoke last, and how the member's own activity looked before, during and after.",
    body: [
      "Hedgie Care (`/admin/care`, `docs/HEDGIE_CARE.md`) replaces the spreadsheet of reach-outs. Admins and the community manager can open it; writing to it needs the `care.write` staff feature, which she and every admin have.",
      "**A care plan** is one stretch of reaching out to one member. Press **Start a care plan**, pick the member, why you are reaching out (an introduction, a welcome, a check-in, a writing check-in, encouragement or something else), the day it really started (today, or an earlier day if you are catching up, never a later one) and a short note with nothing sensitive in it. A plan belongs to the member, not to a channel: a member has one open plan, whether you reach them in Slack, by email or in a prickle, so what you read about them stays in one place. A plan runs for 30 days from its start. \"Change start date\" fixes a plan entered with the wrong day; the end moves with it. When a plan ends there is simply no explicit plan for the member: you **renew** it (a new plan that continues the one before, \"second plan\", with a short reason and the results so far in front of you) or **close** it with how it ended: handed to someone else, no reply, back in the community, or ran its course.",
      "**Where each one stands** is worked out, not typed: needs your reply, waiting on them, gone quiet, review due or lapsed. A member who wrote last stays on \"needs your reply\" until you answer, renew or close, however old the plan is. The Active tab lists what needs you; the Earlier tab holds closed and lapsed plans; a summary at the top counts what is overdue and whose it is.",
      "**Slack DMs fill in who spoke last, with nothing to choose.** When you hold a care plan with a member, your own 1:1 Slack DM with them is read for it: starting a plan tracks the DM when the Hub has one, and so does a plan you hold when you open Hedgie Care. The plan is the reason, so there is no list of DMs to pick from and nothing to switch off. Who spoke last is worked out from who wrote and when (the messages themselves are in the plan's Messages, below); DMs with staff are never read for this, group DMs are not included, and other staff cannot see which DMs you track beyond those messages. On a plan that follows your DM, the \"They replied\" and \"I replied\" buttons give way to \"Filled in from your Slack DM\", and **Open the DM** takes you to it. Where your DM is not available the plan says so quietly: \"Connect Slack so your DM with them fills in\" (a link, and one dismissible note on the Active tab while you hold an open plan), or \"No DM with them yet.\" This needs Slack connected with direct message access and the `slack_dm_bridge` feature on for you. Where nothing is filled in, you log \"They replied\" and \"I replied\" yourself.",
      "**Messages** (the button on a plan) shows the full messages of the member's tracked Slack DM(s), exactly as they were sent, from the start of each of their care plans to its close (or until now while it is open), newest plan first, a page at a time. It covers all of that member's plans, whoever held them, so whoever holds a plan (after a hand-over they accepted, or an admin's takeover) sees the earlier ones' messages; it reads every DM tracked with the member, so messages stay readable after a hand-over, and the new owner's own DM with the member is tracked when they accept the plan. Messages outside a plan, deleted messages and files' contents are not shown. Admins and community managers can open it (assistants cannot), opening it is recorded in the audit log (who, whose plan, when; never the messages), and if the record cannot be written nothing is shown. Hub Chat tells people in a tracked DM that our community manager and admins can read what is sent in it during a plan, and `/privacy` says so in \"Messages in a Hedgie Care plan\".",
      "**Owners and hand-overs.** A new plan is owned by whoever starts it; if someone else cared for that member before, the start form says so. A plan changes hands when the other person agrees, with one exception for admins (below): the owner (or an admin, for an owner who is gone) offers it to another admin or community manager with **Hand over to…**, and it waits, showing \"Waiting for\" their name \"to accept\" until they answer. The receiver finds it under **Waiting for you** at the top of Active and Earlier and accepts or declines; the plan stays with its owner until then, and an offer can be cancelled. Accepting also starts reading the new owner's own DM with that member. A plan whose owner's account was removed can be taken by anyone who looks after care plans. **The exception:** an admin can **take over** any open plan from its owner without waiting for a yes, for an owner who cannot be reached or when you have to step in; a closed plan stays with its owner. The person it was taken from sees \"Taken over\" at the top of their Active and Earlier tabs, saying who took which member's plan and when, with a Dismiss button. Nothing is sent: the receiver of an offer, and the person a plan was taken from, hear about it on this page only for now. Both tabs still filter by Mine or Everyone.",
      "**On every plan** you see the member's engagement score and tier when the plan started and now, and when they last took part in the community and in what (a prickle, a Slack message or reaction, a lesson, a writing log; never a login).",
      "**Results** (the button on a plan) set the member's own activity before the plan, during it and 30 to 60 days after it ends: distinct prickles attended, Slack messages, whether their first prickle or first Slack post fell in the window, and how many other members they connected with. It also says whether they were active, on hiatus or cancelled 60, 90 and 180 days after the plan, when they first went on hiatus or left, the programs they hold and how long each runs, and the programs they started. These describe what happened; they do not prove the outreach caused it.",
      "**Activity during this plan** (the button on a plan, open or earlier) lists what the member did while that plan ran, newest first: their prickles, Slack and Hub chat messages and reactions, check-ins, lessons and writing logs, the emails the Hub sent them and what they did with them, and the plan's own moments (started, renewed, handed over, closed). A message shows where and when, never what was said, and logins are left out. Admins and the community manager can open it, and each plan lists only its own stretch of time.",
      "**What is recorded.** Every step of a plan is a line in the Activity Log (`/admin/activity`, and the member's Activity tab) in plain words: \"started a care plan\", \"renewed the care plan (second plan)\", \"closed the care plan: ran its course\", \"offered the care plan to\" a colleague, \"accepted\" it, \"declined\" it, \"took back the offer\", \"took a care plan that had no owner\", \"took over the care plan from\" a colleague, \"dismissed the notice that a care plan of theirs was taken over\", \"moved the care plan's start to\" a day, and \"removed the care plan\". The note and the next step are never in the log, only that they changed, and the member cannot read these rows about themselves. Behind the scenes the table is `care_engagements`; routes, settings and events keep that name.",
    ].join("\n\n"),
  },
  {
    slug: "chat-link-previews-for-hub-messages",
    date: "2026-11-10",
    audience: "engineering",
    category: "new",
    title: "Hub Chat makes link previews for messages written in the Hub, and authors can remove any preview",
    summary: "A link in a message sent from the Hub gets a preview card (or the picture itself, for a link to an image), behind a feature flag, and the author can remove a preview, Slack's included, with an X on the card.",
    body: "Slack builds no preview for messages the Hub posts, so the Hub makes its own, once, on the server, when the message is sent and the sender has the feature flag. Previews are never made when someone views a message. The author can remove any preview, Hub's or Slack's, and the two sides stay in step.\n\n- **Fetch at send time only**, through the shared safe download; failures are remembered so a link is not asked for twice, and an edit only looks at links it added.\n- **One card per link:** where the Hub has its own preview, Slack's card for the same address is dropped; where it has none, Slack's is shown. A card already on screen is never swapped.\n- **Removal works both ways:** removing a card in the Hub removes it in Slack (best effort, with a visible note if it fails), and removing it in Slack hides the Hub's card.\n- **The one exception to the no-link-previews rule:** a member's own message is conversation, so it is posted with previews on. Automatic messages never unfurl.\n\nConfirmed in production in both directions on 2026-11-12. Detail: `docs/SLACK_BRIDGED_CHAT.md`, \"Link previews for messages written in the Hub\".",
  },
  {
    slug: "outbound-user-agent",
    date: "2026-11-10",
    audience: "engineering",
    category: "improved",
    title: "Every outbound request says who we are: one User-Agent",
    summary: "The Hub's requests to other services now send one consistent, valid User-Agent with a version and a way to reach us, and the SDKs we use add it next to their own.",
    body: "Some hosts refuse a request with no User-Agent (Wikimedia answers 403), and others want a name and contact so they can reach us instead of blocking us. So every request to a server that is not ours sends one User-Agent, defined once as `OUTBOUND_USER_AGENT` in `lib/config.ts`: `HedgieHub/<version> (+<app url>; <support email>)`. The version is the first 7 characters of the deployed commit (`dev` when there is none), the product token, URL and email come from `app.config.ts`, and the comment carries nothing about a member. A request can name its feature with `userAgentWith(\"slack-import/1\")`.\n\n**Rule:** a raw request to someone else's host goes through `outboundFetch` (`lib/http/outbound.ts`); an SDK gets our part wired once, where its client is built, added next to the SDK's own and never replacing it. A test fails on a new unwrapped external call or a Slack client built outside `createSlackClient`. Detail: `docs/OUTBOUND_REQUESTS.md`.",
  },
  {
    slug: "safe-outbound-fetch",
    date: "2026-11-10",
    audience: "engineering",
    category: "new",
    title: "One safe way to download an address somebody else chose",
    summary: "Anything the server downloads from an address that came from a member, a message or an import now goes through one shared helper that refuses internal addresses, limits size and time, and checks what came back.",
    body: "**Rule: any server-side download of an address that came from a user, a message or an import goes through `lib/net/safe-fetch.ts`**, never a bare request. It holds the safety rules once (`fetchImage` and `fetchPage` sit on `safeGet`).\n\n- **Only public https:** the name is resolved once, every answer must be a public address, and the connection is pinned to it.\n- **Bounded:** redirects are followed by hand and re-checked at every hop; size is capped while streaming and time is budgeted on the clock helper.\n- **Judged by content, not headers:** an image's type comes from its first bytes, and SVG is refused.\n- **Testable offline:** tests swap the name lookup and the socket (`setNetHooks`).\n\nUsed by the chat picture proxy, link-preview page reads, the book-cover import and member photo copies. Detail: `docs/OUTBOUND_REQUESTS.md`.",
  },
  {
    slug: "content-security-policy-report-only",
    date: "2026-11-10",
    audience: "engineering",
    category: "new",
    title: "A Content-Security-Policy that reports what it would block",
    summary: "Every response now carries a Content-Security-Policy in report-only mode: browsers tell us which pictures a stricter policy would block, and nothing is blocked yet.",
    body: [
      "Every response carries a report-only Content-Security-Policy, built by `buildCsp` in `lib/csp.ts` and sent from `next.config.ts`. It covers pictures, plugins, base address, form targets and framing; scripts and styles are not covered (that would need a nonce per request). Nothing is blocked: browsers report what a stricter policy would block.",
      "- **Reports go to Sentry**, derived from the public DSN (no new environment variable). A report carries the page address and the blocked origin, never page content.\n- **The allowed picture hosts live in config** (`csp.imageHosts` in `app.config.ts`): trust a host there on purpose, or fix a stale stored address in the data. A host that only shows up because of a bad address is a data bug, not a list entry.",
    ].join("\n\n"),
  },
  {
    slug: "member-photos-outlive-their-source",
    date: "2026-11-10",
    audience: "engineering",
    category: "new",
    title: "Member photos outlive their source: a copy in our own storage",
    summary: "A member's profile photo can now be kept in our own storage, and member processing prefers that copy over Kajabi, Slack and Gravatar, so it survives Kajabi being retired.",
    body: [
      "A member's photo is rebuilt on every members processing run from Kajabi, then Slack, then Gravatar, so a plain copy of a file would be reverted by the next run. The copy is therefore remembered as a member override that processing prefers, and the files live in our own public storage, small and keyed by content (`docs/MEDIA_LIBRARY.md`, \"Member photos\").",
      "- **General pattern:** when a derived field must outlive its source, store an override that the derivation prefers, rather than editing the derived value.\n- **`pnpm photos:adopt`** moves photos off the Kajabi CDN. It is a dry run unless given `--apply`, uses the shared safe download (\"One safe way to download an address somebody else chose\") and is safe to run again. It was applied in production on 2026-11-11.\n- **Still loaded directly:** Gravatar, and Slack photos for people not matched to a member (\"Where pictures come from\").",
    ].join("\n\n"),
  },
  {
    slug: "chat-picture-proxy-and-csp",
    date: "2026-11-10",
    audience: "engineering",
    category: "improved",
    title: "Pictures under chat messages go through the Hub, and the app sends a Content-Security-Policy in report-only mode",
    summary: "Link previews, app cards and logos in chat are fetched by the Hub instead of by each viewer's browser, and every page now reports which pictures a stricter policy would block.",
    body: "**Rule: a picture someone else chose never loads from the viewer's browser.** Chat pictures (previews, app cards, logos) go through one route, the picture proxy, so no image host learns who looked and the Hub never trusts an address from a request.\n\n- **The request names no address.** It names a message and a key (a hash of the picture's address); the server finds the address in the message itself.\n- **Access is the viewer's own read of the message**, so row-level security decides, and a deleted message is a 404.\n- **Keyed by address, not by position**, since positions shift when Slack's copy of a message arrives.\n- **One copy is kept for a week** in our storage and swept nightly, so the other site is asked once, not per viewer. Downloads use the shared safe fetch.\n\nEvery page also sends a Content-Security-Policy in report-only mode that reports what a stricter policy would block. Detail: `docs/SLACK_BRIDGED_CHAT.md`, `docs/OUTBOUND_REQUESTS.md`.",
  },
  {
    slug: "see-your-image-before-you-save-it",
    date: "2026-11-07",
    audience: "product",
    category: "improved",
    title: "See your image before you save it",
    image: { src: "/changelog/see-your-image-before-you-save-it/01-previews.webp", alt: "The image editor with the Event card and Book cover previews, the Book cover marked not saved yet" },
    summary: "When you choose a picture you now see it straight away. When you click where the interesting part is, the event and book cover previews change as you click.",
    body: "- After choosing or dropping a file, you see the picture itself, not just its file name. (Your browser can't show some phone photos; you'll see the file name instead.)\n- In the image editor, clicking the picture to say where the interesting part is, or changing how a picture that isn't cover-shaped fits, updates the Event card and Book cover previews straight away. They say \"not saved yet\" until you save.\n\n![The image editor: the Event card and Book cover previews, with the Book cover marked not saved yet](/changelog/see-your-image-before-you-save-it/01-previews.webp)\n\n- After you save a new interesting part, pages that already show the image update within about a minute.",
  },
{
    slug: "first-app-skeleton-and-prd",
    date: "2026-04-04",
    audience: "engineering",
    category: "new",
    title: "First app skeleton: Next.js, Tailwind and the product requirements doc",
    summary: "The repository starts as a Next.js App Router project with Tailwind, an internal landing page for stakeholders and a product requirements document rendered in the app.",
    body: "The repository began as a Next.js App Router project with Tailwind and TypeScript. It has an internal landing page for stakeholders (roadmap, feature preview, tech stack) and a product requirements document kept as markdown in docs/ and rendered in the app with the Tailwind typography plugin. It started as an internal admin portal for staff, not a member-facing app, which shaped the early choices: dashboards and data hygiene came before anything members would touch.",
  },
  {
    slug: "magic-link-auth-and-local-supabase",
    date: "2026-04-04",
    audience: "engineering",
    category: "new",
    title: "Passwordless sign-in with Supabase magic links and a local Supabase stack",
    summary: "Sign-in is by emailed magic link only, with Next.js middleware protecting the dashboard and a Docker-based local Supabase with Mailpit for catching emails.",
    body: "Sign-in is by emailed magic link only: no passwords exist anywhere, which kept the later invite-only decision simple. The login page asks for an email, Supabase Auth sends the link, and a callback route exchanges it for a session. Client and server Supabase helpers use the SSR package, and middleware redirects anonymous visitors away from protected routes. Local development runs Supabase in Docker with Mailpit catching emails, so nothing real is sent. The rule: auth goes through Supabase Auth helpers, never hand-rolled sessions. See docs/SETUP.md for the local flow.",
  },
  {
    slug: "declarative-schema-and-prickles-naming",
    date: "2026-04-04",
    audience: "engineering",
    category: "new",
    title: "Declarative database schema in Bronze, Silver and Gold layers; sessions become prickles",
    summary: "The data model is written as a declarative schema file organised as a medallion architecture, and the community's own word, prickle, replaces session in the schema and code.",
    body: "The data model is a declarative schema file organised as a medallion architecture: Bronze (raw, as the source said it), Silver (transformed) and Gold (analytics views). Migrations are generated from the schema file. Zoom participants are stored in the shape of the Zoom API's report with the full raw payload, and a CRM-style activity log carries flexible metadata and a weighted engagement value. Hiatus periods have one source of truth. The community's own word, prickle, replaced \"session\" throughout schema and code, so new work uses community vocabulary from the start. See docs/MEDALLION_ARCHITECTURE.md.",
  },
  {
    slug: "zoom-api-import",
    date: "2026-04-04",
    audience: "engineering",
    category: "new",
    title: "Zoom import: API client with retry and an immutable attendee table",
    summary: "Zoom meetings and participants can be imported by date range into a raw attendees table, with backoff on rate limits and no duplicates when ranges overlap.",
    body: "Zoom meetings and participants are imported by date range into a raw attendee table. The client does the OAuth flow and retries rate-limit responses with exponential backoff (1s doubling up to 16s, five tries), and with shorter backoff on transient network errors. Re-importing an overlapping range never doubles anyone: the raw rows are effectively immutable, keyed on meeting, name and join time, and duplicates are ignored. That is deliberately the opposite of the Kajabi snapshots, because a Zoom participant row is a fact while a Kajabi contact is a state. Rule: choose append-only or snapshot per source by whether a row is a fact or a state.",
  },
  {
    slug: "kajabi-csv-import-and-snapshot-history",
    date: "2026-04-04",
    audience: "engineering",
    category: "new",
    title: "Kajabi CSV imports stored as temporal snapshots",
    summary: "Member data comes in from Kajabi CSV exports that are auto-detected, and every import is kept as a dated snapshot so changes over time can be seen.",
    body: "Member data first came from Kajabi CSV exports. The import detects a contacts export or a subscriptions export by its columns. Every import is kept as a dated snapshot rather than overwriting, which gives an audit trail and makes it possible to see when tags or products changed; that history is the basis for deriving hiatus periods. For subscriptions with several rows per email, Active wins over Paused over Canceled, and two date formats are accepted. The subscriptions export exists because the contacts export left stale products on cancelled members. Rule: keep raw state as history and let processing pick the latest.",
  },
  {
    slug: "member-status-rules-from-kajabi",
    date: "2026-04-04",
    audience: "engineering",
    category: "fixed",
    title: "Member status derived from Kajabi products and tags, with Offboarding first",
    summary: "Active, on hiatus and inactive are worked out from what a Kajabi contact has, and the Offboarding tag now wins over a lingering membership product.",
    body: "Active, on hiatus and inactive are derived from what a Kajabi contact holds. A membership product means active. The member tag without the product means the member paused. Neither, or an Offboarding tag, means inactive, and the Offboarding tag is checked before products because cancelled members can keep the product while paused members lose it but keep the tag. The dashboard's total member count excludes inactive people. Rule: status is derived from source data in the processing step, never typed by hand, and real data decides the order of checks.",
  },
  {
    slug: "member-name-matching-v1",
    date: "2026-04-04",
    audience: "engineering",
    category: "new",
    title: "Name matching in SQL: email, alias, normalized and fuzzy",
    summary: "Zoom display names can be matched to members in four steps of decreasing confidence, using a manual alias table and trigram similarity.",
    body: "Zoom display names are matched to members in decreasing confidence: exact email, then a manual alias, then a normalized name (all high confidence), then trigram similarity of at least 0.4 (medium or low). Attendees often join under a nickname, so the most trustworthy match is returned first and a confidence score travels with the result. A manual alias table lets staff teach the matcher. Tests cover each tier. The matching logic lives in application code, not the raw Zoom table, so raw tables stay exactly what the source said. See docs/MEMBER_MATCHING.md.",
  },
  {
    slug: "medallion-processing-members-and-attendance",
    date: "2026-04-04",
    audience: "engineering",
    category: "improved",
    title: "Medallion split: imports write Bronze only, processing routes build Silver",
    summary: "Imports store raw data untouched and separate processing routes compute members and attendance, after matching logic was pulled back out of the raw Zoom table.",
    body: "Imports store raw data untouched; separate processing routes compute members and attendance. The rule, written in the architecture doc: Bronze holds only what the source said, Silver is inferred. Matching columns that had been added to the raw Zoom table were reverted for that reason. Members processing builds members from the latest Kajabi snapshot per email. Attendance processing reads Zoom attendees in a date range, matches each to a member (email, alias, normalized, fuzzy), creates prickles from Zoom meetings and writes attendance with a confidence score, skipping unmatched people and reporting match rates. The data-flow dependencies between routes are documented, and so is the idea of moving to streaming. This split is the basis of everything that followed. See docs/MEDALLION_ARCHITECTURE.md.",
  },
  {
    slug: "first-engagement-dashboard-and-at-risk",
    date: "2026-04-04",
    audience: "engineering",
    category: "new",
    title: "First engagement dashboard with at-risk members",
    summary: "The admin dashboard shows member counts, recent prickles, top attendees and a list of active members who have not attended lately.",
    body: "The admin dashboard shows member counts (total, active, on hiatus), prickles in the last 30 days, attendance totals, the top ten attendees and an at-risk list of active members with no recent attendance, including those with none ever. A dedicated page lists them all. These were computed live in the page queries, which is what the Gold layer meant at the time.",
  },
  {
    slug: "name-matching-report-and-alias-tools",
    date: "2026-04-05",
    audience: "engineering",
    category: "new",
    title: "Name matching tools: unmatched report, drag-and-drop game and alias search",
    summary: "Staff get pages that show which Zoom names did not match anyone and a quick way to link them to members as aliases.",
    body: "A name matching report lists active members with zero attendance, Zoom names seen three or more times without a match, and possible matches by email, written to push the match rate beyond the roughly 92 percent the automatic rules achieved. It became an interactive drag-and-drop pairing page and a search-and-autocomplete form that attaches a name to any member, since writers can have several identities, pen names and emails. The unmatched list calls the real match function instead of a lookalike query, so it cannot disagree with processing. See docs/MEMBER_MATCHING.md.",
  },
  {
    slug: "google-calendar-sync-bronze-to-silver",
    date: "2026-04-05",
    audience: "engineering",
    category: "new",
    title: "Google Calendar sync into a Bronze events table, processed into prickles",
    summary: "The community calendar is read with a service account into raw calendar events, and a separate step turns those into prickles, so the schedule is rebuilt from source.",
    body: "The community calendar is read by a Google service account (the calendar is shared with it, so there is no token expiry or user interaction). A sync route writes unmodified events, full JSON with creator and organizer, to Bronze idempotently by upsert (30 days back and 90 forward by default), and a separate processing route turns them into prickles, so the schedule is always rebuilt from source. Processing extracts the prickle type and host from titles shaped like a type, \"w/\", then a host, and normalises type spellings. Rule: sync stores raw, processing infers. See docs/CALENDAR_SETUP.md and docs/CALENDAR_SYNC.md.",
  },
  {
    slug: "first-pagination-and-row-limit-lesson",
    date: "2026-04-05",
    audience: "engineering",
    category: "fixed",
    title: "PostgREST row limit hit: raise-the-limit abandoned for real pagination",
    summary: "Calendar processing silently saw only 1000 events; the fix was to page through results in batches rather than keep raising the server limit.",
    body: "Supabase returns at most a fixed number of rows per request regardless of the limit asked for, so calendar processing silently saw only 1000 events. Raising the server ceiling was tried and rejected: a hardcoded ceiling is only a delay. The fix was to read events in 1000-row batches with ranges, which works for any volume. This became the standing rule to paginate anything that can exceed 1000 rows, backed by regression tests. See CLAUDE.md, \"Database Query Limits\".",
  },
  {
    slug: "prickle-types-and-popup-prickles",
    date: "2026-04-05",
    audience: "engineering",
    category: "new",
    title: "Prickle types table, host parsing and Pop-Up Prickles",
    summary: "Prickles now have a type from a lookup table, a host linked to a member, and unscheduled Zoom meetings become Pop-Up Prickles.",
    body: "Prickles have a type from a seeded lookup table (13 types, such as Progress, Pop-Up and Heads Down) with admin screens to manage it, and a host linked to a member rather than free text, which enabled member pages with attendance history and a marker on prickles they hosted. A shared library normalises type names and parses type and host from calendar titles; events it cannot place go to a review queue for staff. A Zoom meeting that overlaps a calendar prickle by at least 15 minutes is matched to it; one that does not becomes a Pop-Up Prickle (PUP). Rule: types and hosts are data, resolved by one parser.",
  },
  {
    slug: "attendance-segmentation-rules",
    date: "2026-04-05",
    audience: "engineering",
    category: "improved",
    title: "Attendance processing rewritten to split Zoom meetings into prickle segments",
    summary: "A long Zoom meeting is now cut into scheduled prickles and pop-ups by documented time rules, and each attendee is assigned by when they were actually present.",
    body: "The first matcher treated each attendee alone and produced overlapping or very long PUPs. The rewrite in `app/api/process/attendance/route.ts` follows the analytics logic of the earlier Python tool: it handles a whole meeting as a unit and splits it into segments. Early and late arrivals of up to 20 minutes are absorbed by the first and last scheduled prickle, longer ones form separate PUPs, and gaps between scheduled prickles become PUPs. A three-pass algorithm (match calendar prickles, create PUPs only from attendees who matched no calendar prickle, then write attendance) fixed PUP windows that stretched across a day. Attendance in a PUP counts only above 15 minutes, using each attendee's own join and leave times, so showing up early for the next prickle is not credited as a PUP. `docs/ATTENDANCE_RULES.md` lists every threshold (20, 15 and 5 minutes for host-late warnings) with rationale.",
  },
  {
    slug: "calendar-heatmap-and-prickle-pages",
    date: "2026-04-05",
    audience: "engineering",
    category: "new",
    title: "Weekly calendar view, prickle detail page and host warnings",
    summary: "Staff can browse a seven-day calendar of prickles with attendance, open a prickle, and see warnings where a host is missing or late.",
    body: "Staff can browse a Sunday-first, seven-day calendar of prickles with attendance, a timezone selector, tooltips and a show/hide for pop-ups, and open a detail page per prickle. Host warnings flag prickles with no host or a host who arrived late. The week grid hit two recurring pitfalls: Next.js 15's async search params and week parameters parsed in the wrong timezone, a class of bug that recurs, so name the zone explicitly (see .claude/rules/dates-and-timezones.md).",
  },
  {
    slug: "dashboard-charts-and-kpis",
    date: "2026-04-05",
    audience: "engineering",
    category: "new",
    title: "Dashboard charts and a short list of engagement KPIs",
    summary: "The dashboard gained attendance charts and was then trimmed to five key metrics.",
    body: "The dashboard has a stacked weekly attendance bar chart with unique attendees and tooltips, a weekly engagement rate (measured over the last seven days, not a calendar week) and median hours, in a blue and green palette for contrast. After trying several KPIs it was cut down to five. The numbers are computed in page queries rather than stored.",
  },
  {
    slug: "rls-invite-only-and-admin-shell",
    date: "2026-04-05",
    audience: "engineering",
    category: "new",
    title: "Row Level Security on every table, invite-only sign-in and a navigation shell",
    summary: "All tables got RLS and a user profile with a role, public sign-up was turned off, and the admin area got a collapsible navigation.",
    body: "Every table has row level security, accounts exist only by invitation (public sign-up is off in config), and each user has a profile with a role of admin, assistant or member, created by a trigger on sign-up. At this stage every authenticated user was effectively an admin, with policies written so they can be refined per role later. An admin helper function backs the policies. The admin area got a collapsible navigation grouped into Data Hygiene and Data Management. See docs/RLS_SECURITY.md for the migration path and docs/INVITING_USERS.md.",
  },
  {
    slug: "vercel-supabase-deployment-guide",
    date: "2026-04-05",
    audience: "engineering",
    category: "new",
    title: "Deployment to Vercel and a hosted Supabase project documented",
    summary: "A step-by-step guide covers creating the Supabase project, pushing migrations, configuring Vercel and a security checklist before going live.",
    body: "A step-by-step guide covers creating the Supabase project, pushing migrations, configuring Vercel, the environment variables needed, turning off public sign-up and a security checklist before going live, with troubleshooting. Type errors that only the production build caught (chart formatters, a host relationship) showed why the build must be checked before commit, which led to the pre-commit build hook. See docs/DEPLOYMENT.md.",
  },
  {
    slug: "batch-processing-for-timeouts",
    date: "2026-04-06",
    audience: "engineering",
    category: "improved",
    title: "Processing routes load reference data once and write in batches",
    summary: "Calendar and attendance processing dropped from thousands of sequential queries to a few dozen, which got them under the serverless time limit.",
    body: "Production processing timed out because routes ran a query per event or attendee (about 6500 for 1337 calendar events, about 1200 for attendance, including one name-matching RPC per attendee). Both routes now load prickles, members, aliases and types up front with `Promise.all()`, match in memory with Map lookups, and write in chunks of 100 to 500 with parallel execution. Process and sync routes also declare `maxDuration = 60` (the default was 10 seconds). These became the written API performance rules in `CLAUDE.md`.",
  },
  {
    slug: "pagination-regression-tests-and-claude-rules",
    date: "2026-04-06",
    audience: "engineering",
    category: "new",
    title: "Pagination regression tests and the first CLAUDE.md architecture rules",
    summary: "After calendar processing silently dropped events past the first 1000, tests and project instructions were added so it could not happen again.",
    body: "After calendar processing silently dropped events past the first 1000, tests and project instructions were added so it cannot recur. The test checks behaviour (1500 events all processed) and code shape (range pagination present, a single unpaginated query absent). CLAUDE.md was created with the query limit rule, the API route performance rules and a review checklist so agents load them every session. The same pass paged an unmatched-events query by date range instead of an id list, and chunked batch deletes to stay under the limit of filters on id lists. See CLAUDE.md.",
  },
  {
    slug: "attendance-allows-leave-and-rejoin",
    date: "2026-04-06",
    audience: "engineering",
    category: "improved",
    title: "Attendance keeps one row per stay: multiple records per member and prickle",
    summary: "The unique constraint on member and prickle was dropped so someone who leaves and rejoins a prickle has both stays recorded.",
    body: "Someone can leave a prickle and rejoin, so attendance keeps one record per stay and there is no uniqueness on member and prickle. Deduplicating first fixed an upsert failure, but merging a 9:00-9:30 stay with an 11:00-11:30 stay would have reported 150 minutes instead of 60. Counting uses distinct prickles while time is the sum of the segments, and tests assert both. The rule is recorded in CLAUDE.md as a standing instruction never to reintroduce the constraint. See CLAUDE.md, \"Attendance Table Design\".",
  },
  {
    slug: "centralized-member-matching-library",
    date: "2026-04-06",
    audience: "engineering",
    category: "improved",
    title: "One TypeScript library for matching names to members",
    summary: "The routes that matched Zoom names to members each did it their own way; a shared library with one priority order replaced them.",
    body: "Name-to-member matching lives in one library with one priority order: email, then alias, then normalized name, with smart matching for variants and case-insensitive comparison. It replaced per-route implementations and SQL procedures after a quarter of active members showed zero attendance purely from name mismatches. Seed aliases cover the common cases. Processing routes and the hygiene dashboard call the same function so their counts agree. Zoom names are trimmed before the alias lookup, and a meeting window comes from matched attendees only, which removed pop-ups with zero attendees. Rule: one matcher, called everywhere. See docs/MEMBER_MATCHING.md.",
  },
  {
    slug: "reprocessability-principle-and-tests",
    date: "2026-04-06",
    audience: "engineering",
    category: "new",
    title: "Reprocessability: Silver is rebuilt from Bronze with delete and insert, with tests",
    summary: "Silver processing was changed to delete the affected rows and insert fresh ones, so a deleted source event disappears, and regression tests were added for it.",
    body: "Silver processing deletes the affected rows and inserts fresh ones, so an event deleted at the source disappears. Selective inserts and updates had left orphans. The principle is written in CLAUDE.md with correct and incorrect examples and a status table, and tests verify four things: a first run creates rows, reprocessing after source deletion removes them, changed source updates them, and orphans are detected. The process routes accept the service role key in the Authorization header as well as cookies so integration tests can call them. Identity tables such as members are the exception and upsert on a stable key, because deleting regenerated member ids. See docs/MEDALLION_ARCHITECTURE.md.",
  },
  {
    slug: "bronze-idempotency-tests-and-sync-race-fix",
    date: "2026-04-06",
    audience: "engineering",
    category: "new",
    title: "Idempotency tests for every Bronze import, and a calendar sync race fixed",
    summary: "Each import (calendar, Zoom, members) is tested to be safe to run repeatedly, after a concurrent sync caused duplicate key errors in production.",
    body: "Every import (calendar, Zoom, members) is tested to be safe to run repeatedly: a first import creates rows, a repeat creates none, changed data updates or appends a new snapshot, and several cycles stay stable. The suites cover the three Bronze patterns: upsert on a natural key, upsert that ignores duplicates, and append-only snapshots. A production race, where overlapping calendar syncs checked then inserted and collided, was fixed by making the write an upsert on the natural key as the final guard. A phased plan covers fixtures, mocked external APIs and per-suite databases for the shared-database interference the tests suffered from. See docs/TEST_INFRASTRUCTURE_PLAN.md.",
  },
  {
    slug: "staff-bronze-table",
    date: "2026-04-06",
    audience: "engineering",
    category: "new",
    title: "Staff table so team members who are not in Kajabi still become members",
    summary: "Owners, staff and contractors are kept in their own table and combined with Kajabi contacts when members are processed.",
    body: "Owners, staff and contractors are kept in their own source table and combined with Kajabi contacts when members are processed, so people who do not pay through Kajabi still have a member record, with a source marker, a staff role and a link to their sign-in account for admin access. Without it, staff who host or attend prickles showed up as unmatched Zoom names. The processing UI shows the breakdown by source, and combining the sources deduplicates by email. Rule: every kind of person has one raw source feeding the single members record.",
  },
  {
    slug: "unmatched-calendar-events-queue-and-decisions",
    date: "2026-04-06",
    audience: "engineering",
    category: "improved",
    title: "Staff decisions on unmatched calendar events survive reprocessing",
    summary: "Events staff resolve or ignore stay that way after the calendar is reprocessed, and prickles can have a fun title separate from their type.",
    body: "Because processing rebuilds prickles, the review queue would have asked the same questions after every run. Processing first loads earlier resolved and ignored decisions: resolved events reuse the stored type, ignored events are skipped, and the UI reports auto-resolved and ignored counts. A partial-match fallback handles type names, a named prickle's own title is stored only when it differs from its type, and unmatched events are cleaned up in batches. Orphaned aliases are removed when members are processed. Rule: human decisions are Local data that survive every rebuild.",
  },
  {
    slug: "data-hygiene-dashboard-orphans-and-ignored-names",
    date: "2026-04-07",
    audience: "engineering",
    category: "new",
    title: "Data hygiene dashboard: orphaned events and meetings, ignored Zoom names, host coverage",
    summary: "Staff get a health page that finds source data that never made it into prickles, with buttons that reprocess exactly the affected range.",
    body: "A health page finds source data that never became prickles: calendar events in neither prickles nor the review queue (found to come from events imported just outside the processed range) and Zoom meetings with no prickle. Each has a button that reprocesses exactly the affected range, not a guess, and a clear error replaced a fixed six-month fallback. The orphan count uses the same matched-attendee window as processing, so the number can fall to zero. Staff can mark bots and test accounts as ignored so they leave the unmatched list, see which prickles a name appeared in, and track host assignment over prickles that need a host. Rule: a report must count the way processing counts.",
  },
  {
    slug: "reprocessing-boundary-fixes-overlap-queries",
    date: "2026-04-07",
    audience: "engineering",
    category: "fixed",
    title: "Reprocessing fixed for meetings that cross midnight and for deleted source data",
    summary: "Processing now deletes and selects everything that overlaps the date range, and always cleans up before checking whether there is new data.",
    body: "Three reprocessability bugs, each with a regression test. Range queries used containment (start and end both inside), so a prickle from 11:30 PM to 12:30 AM was neither deleted nor selected and orphans accumulated; they are now overlap queries (starts before the range ends, ends after it starts). Date-only inputs such as 2026-04-07 mean midnight, so the range end is normalised to the start of the next day. Attendance processing returned early when no attendees were found, before its deletes ran, so removing Bronze data never removed the Silver pop-ups; the deletes now run first. Rule: scope rebuilds by overlap and delete before any early exit.",
  },
  {
    slug: "member-pages-network-graph-and-attendance-calendar",
    date: "2026-04-07",
    audience: "engineering",
    category: "new",
    title: "Member detail pages gain an attendance calendar and a network graph",
    summary: "A member page can show attendance as a month calendar, and a new page draws who attends prickles together as a graph.",
    body: "Member pages have a monthly attendance calendar with up to three prickles per day, a details panel for the chosen day and list and calendar subtabs. The network page is a force-directed graph with its own physics simulation: node size from total attendance, edge thickness from co-attendance, the top 50 connections by default, search and click to focus one member, and pan and zoom controls. Edges for calendar prickles are filtered, and fixes for hydration mismatches in the sidebar and a mobile navigation flicker came with it.",
  },
  {
    slug: "profile-theme-and-timezone-preferences",
    date: "2026-04-07",
    audience: "engineering",
    category: "new",
    title: "Profile settings: theme in the browser, timezone in the database",
    summary: "Users can pick light, dark or system theme and a timezone, stored in different places on purpose.",
    body: "Users choose light, dark or system theme and a timezone, stored in different places on purpose. Theme is a device choice kept in local storage with class-based dark mode. The timezone is an account preference users can update on their own row, set through a server action, with 40 or more zones grouped by region and defaulting to the browser's zone; calendars and timezone dropdowns use it as default. The reasoning is in comments in the switcher components. Functions run by the auth admin role, which lacks the public schema in its search path, must schema-qualify tables and pin their search path, or creating users fails.",
  },
  {
    slug: "kajabi-external-ids-and-api-options",
    date: "2026-04-08",
    audience: "engineering",
    category: "improved",
    title: "Kajabi and Stripe ids merged across imports; automation options researched",
    summary: "Member records pick up both a Kajabi contact id and a Stripe customer id even though they come from different CSV exports.",
    body: "Contacts exports carry the Kajabi contact id and subscriptions exports carry the Stripe customer id (as the provider id when the provider is Stripe), so using only the latest snapshot lost one of them. Processing groups snapshots by email, takes the core fields from the latest and the first non-null external id from any snapshot, which feeds the Kajabi and Stripe links on the member page header. A document compares three ways to stop exporting by hand: the Kajabi API, bulk export, and Zapier or Make versus a browser scraper. See docs/KAJABI_API_SETUP.md.",
  },
  {
    slug: "slack-bronze-tables-and-csv-export-import",
    date: "2026-04-09",
    audience: "engineering",
    category: "new",
    title: "Slack data lands in Bronze: tables, an export script and a CSV import",
    summary: "Slack messages, reactions, channels and users are stored raw, loaded first from an exported set of CSV files.",
    body: "Slack messages, reactions, channels and users are stored raw in Bronze, loaded first from exported CSV files. An export script built on the Slack web API pulls users, channels, messages and reactions and joins public channels (the checked-in app manifest holds placeholders only). The import parses CSVs including fields with embedded newlines, accepts the service role key for scripts, and takes four files at once. Messages use a soft delete. Staff can hide non-member Slack users and attach aliases to Slack names, and the unmatched users report, manual alias creation and skip-a-non-member APIs support matching Slack accounts to members.",
  },
  {
    slug: "slack-processing-and-member-activity",
    date: "2026-04-09",
    audience: "engineering",
    category: "new",
    title: "Slack processing into member activities, with matching and reprocessability tests",
    summary: "Slack messages and reactions become member activity rows, matched to members by a dedicated library, and shown on member pages.",
    body: "Slack messages and reactions become member activity rows, matched to members by a dedicated library, and appear on member pages. The processing route follows the pipeline rules: paginated Bronze reads, in-memory matching, delete then insert in chunks of 500, deleted messages and removed reactions skipped, an engagement value derived from message characteristics, and a maximum duration of 300 seconds. Member pages show message and reaction counts for the last 30 days, active channels and a recent feed with emoji rendering and links, filterable by type and channel. Reprocessability, idempotency and matching tests ship with it.",
  },
  {
    slug: "bronze-schema-and-prickle-attendance-rename",
    date: "2026-04-22",
    audience: "engineering",
    category: "improved",
    title: "Bronze tables move into their own Postgres schema; attendance becomes prickle_attendance",
    summary: "Raw import tables now live in a bronze schema and each table is labelled Bronze, Local or Silver, so the layers are visible in the database.",
    body: "Raw import tables live in a bronze schema and every table's comment declares its layer: Bronze is raw with idempotent imports, Local is operational data this app owns and never reprocesses, Silver is derived and reprocessable, so the layers are visible in the database itself. The attendance table was renamed to match the prickle vocabulary. PostgREST has to be told about the schema: it is exposed to the API and in the search path, queries name the schema explicitly, and new tables need grants. See docs/MEDALLION_ARCHITECTURE.md.",
  },
  {
    slug: "member-email-aliases-and-merged-identity",
    date: "2026-04-22",
    audience: "engineering",
    category: "new",
    title: "Email aliases so one person with several addresses is one member",
    summary: "A member who appears in Kajabi under more than one email is merged into one record, with external ids combined.",
    body: "A member who appears in Kajabi under more than one email is merged into one record, with external ids combined. Alternative emails map to a canonical one in a Local alias table. Members processing resolves aliases first, deduplicates by canonical email and merges Kajabi and Stripe ids across all of a person's addresses. See docs/MEMBER_MATCHING.md.",
  },
  {
    slug: "auto-processing-dependency-triggers",
    date: "2026-04-22",
    audience: "engineering",
    category: "new",
    title: "Imports and local changes now trigger Silver reprocessing automatically",
    summary: "After an import, or after staff change an alias, an ignored name or a prickle type, the affected Silver data is rebuilt without a button press.",
    body: "After an import, or after staff change an alias, an ignored name or a prickle type, the affected Silver data is rebuilt without a button press. A processing trigger library knows which Silver layers depend on which source and runs them in order. Bronze imports reprocess the date range they covered; Local changes (name aliases, ignored Zoom names, prickle types, bulk alias application) reprocess the last 90 days by default. The dependency map is an ordering constraint only: a member change need not force prickles and attendance to reprocess. Import responses wait for processing and show its results, and a Manual Reprocessing section handles custom ranges. See docs/MEDALLION_ARCHITECTURE.md.",
  },
  {
    slug: "default-hosts-and-missing-hosts-page",
    date: "2026-04-23",
    audience: "engineering",
    category: "new",
    title: "Prickle types can require a host and name a default one",
    summary: "Staff can say which prickle types need a host and who hosts by default, so the host health metric counts only real gaps.",
    body: "Staff say which prickle types need a host and who hosts by default, so the host health metric counts only real gaps (93 percent instead of 53 in one example). Calendar processing falls back to the default host when a title names none. A missing-hosts page with member autocomplete lets staff assign defaults. Row level security was corrected so upserts work for signed-in users on the attendance, alias and Bronze tables, and shared formatters and a modal component were extracted. Rule: health metrics count only prickles that require a host.",
  },
  {
    slug: "daily-reconciliation-cron-jobs",
    date: "2026-04-23",
    audience: "engineering",
    category: "new",
    title: "Nightly reconciliation of calendar, Zoom and members from Vercel Cron",
    summary: "Three scheduled jobs re-fetch the last 90 days from Google Calendar and Zoom and rebuild members, as a safety net for anything live updates miss.",
    body: "`/api/reconcile/calendar`, `/api/reconcile/zoom` and `/api/reconcile/members` upsert into Bronze (calendar and Zoom from their APIs; members from the latest Kajabi snapshot, since Kajabi was imported by CSV then) and trigger Silver reprocessing. `vercel.json` schedules them at 2:00, 2:30 and 3:00, staggered so calendar data exists before attendance needs it. They authenticate with a `CRON_SECRET` bearer or a signed-in user. A README documents the jobs. This is the start of the rule that nothing may depend on webhooks alone.",
  },
  {
    slug: "realtime-webhooks-and-signature-verification",
    date: "2026-04-23",
    audience: "engineering",
    category: "new",
    title: "Webhook receivers for Google Calendar, Zoom and Slack with signature checks and tests",
    summary: "Live updates arrive at webhook endpoints that verify who sent them, write to Bronze and start processing without making the sender wait.",
    body: "Live updates arrive at webhook endpoints for calendar, Zoom and Slack. Each verifies its sender (Google channel token, Zoom HMAC-SHA256 signature, Slack HMAC-SHA256 with a five minute timestamp window, each degrading gracefully when a secret is unset), writes to Bronze, starts Silver processing and answers 200 quickly. Handlers without a user session, such as Slack's, use the service role client. Tests use Mock Service Worker with fixtures based on the providers' payload documentation. Rule: verify before trusting, and webhooks are latency optimizations only (see the nightly reconciliation). See docs/WEBHOOK_TESTING.md.",
  },
  {
    slug: "atomic-reprocessing-functions",
    date: "2026-04-23",
    audience: "engineering",
    category: "improved",
    title: "Atomic reprocessing in SQL functions so readers never see half-rebuilt data",
    summary: "Prickles, attendance and members are replaced inside one database transaction instead of a delete followed by separate inserts.",
    body: "Prickles, attendance and members are replaced inside one database transaction through RPC functions, so a failure never leaves a half-rebuilt table. The attendance function inserts pop-ups, maps client-side temporary ids to real ones and inserts attendance referencing both, using CTEs. Batch sizes stay under URI length limits, and each function sits in its own migration file because the local migration runner cannot send several function definitions in one prepared statement. Rule: Silver rebuilds are one atomic function per layer.",
  },
  {
    slug: "stable-member-ids-identity-vs-event-entities",
    date: "2026-04-23",
    audience: "engineering",
    category: "fixed",
    title: "Members are upserted by email so ids and relationships survive reprocessing",
    summary: "Rebuilding members by delete and insert gave everyone a new id and orphaned aliases, hosts and attendance, so members now keep their ids.",
    body: "The earlier delete-and-insert members processing was a mistake for an identity table. The atomic function now upserts by email: the same email keeps the same id, so aliases, prickle hosts and attendance foreign keys stay valid, and people who leave are kept as inactive rather than removed. The architecture spec was updated to separate two patterns: identity entities (members, products, channels) are upserted by a stable key over the full table, event entities (prickles, attendance) are deleted and inserted by scope so orphans disappear. Alias reprocessing also now triggers calendar processing, and attendance is reprocessed when calendar prickles change.",
  },
  {
    slug: "precommit-build-hook",
    date: "2026-04-27",
    audience: "engineering",
    category: "new",
    title: "Pre-commit hook that runs the production build",
    summary: "A git hook runs the production build before each commit so type errors that only appear in a strict build are caught locally.",
    body: "A git hook runs the production build before each commit and blocks it on failure, with an escape hatch. It was added after several deployments failed on type errors the dev server had accepted (missing interface properties, null safety, mismatches). Linting and the hook are now managed in the repo with Husky.",
  },
  {
    slug: "kajabi-and-slack-api-imports",
    date: "2026-04-28",
    audience: "engineering",
    category: "new",
    title: "Kajabi and Slack imported straight from their APIs",
    summary: "Production imports pull from the Kajabi and Slack APIs, and the CSV uploads moved to a separate testing page.",
    body: "The Kajabi client uses the OAuth client credentials flow, caches the access token until 90 percent of its life and fetches paginated JSON:API pages with a required site filter. Kajabi has no subscriptions endpoint, so subscriptions are read from purchases (a null deactivation time means active, amounts converted from cents), and customers are fetched and joined by id because the purchase lacks the email that hiatus processing groups by; purchases with no customer are skipped with a warning. The Slack import covers messages and reactions for a 7, 30 or 90 day window, auto-joins public channels and allows five minutes. Both write Bronze idempotently and trigger processing. The import page shows API imports, and a testing page keeps the CSV forms for development. See docs/KAJABI_API_SETUP.md.",
  },
{
    slug: "kajabi-bronze-tables-and-api-sync",
    date: "2026-05-12",
    audience: "engineering",
    category: "new",
    title: "Kajabi data imported through its API into Bronze tables",
    summary:
      "Contacts, customers, purchases and offers from Kajabi now land in their own raw tables, fetched through Kajabi's API instead of CSV uploads.",
    body: "Kajabi contacts, customers, purchases and offers land in their own raw tables, fetched through Kajabi's API with an OAuth 2.0 client-credentials token instead of CSV uploads; the older CSV-based tables were marked deprecated because purchases (and later Stripe subscriptions) replace them. Kajabi's responses are JSON:API with everything under attributes, every request needs a site filter or it returns 500, and purchases give no total page count, so paging stops when a page comes back short. Subscriptions are purchases in Kajabi, and a customer's email is not on the purchase, so customers are fetched separately and joined on the customer id. Membership logic reads purchases for that reason.",
  },
  {
    slug: "stripe-bronze-layer-and-upsert-functions",
    date: "2026-05-12",
    audience: "engineering",
    category: "new",
    title: "Stripe customers, products and subscriptions imported into Bronze",
    summary:
      "A Stripe client and import route copy customers, products and subscriptions into raw tables, so we can tell active from paused or cancelled members.",
    body: "A Stripe client and import copy customers, products and subscriptions into raw tables, because Kajabi's API does not expose a paused subscription, so Stripe is the authority for active, paused and cancelled. The data was kept Bronze-only until the reconciliation rules were settled. Writes go through SQL upsert functions, since the PostgREST schema cache did not see the newly migrated tables right away. The subscription period dates were not on the root object in the Stripe API version used, so they are read with a cast, pending typings. See docs/STRIPE_KAJABI_COMPARISON.md.",
  },
  {
    slug: "member-processing-from-kajabi-bronze",
    date: "2026-05-12",
    audience: "engineering",
    category: "improved",
    title: "Member processing rebuilt on the Kajabi Bronze tables",
    summary:
      "The members step now reads Kajabi contacts and purchases from Bronze, so it can be re-run from raw data at any time.",
    body: "Members processing reads Kajabi contacts and purchases from Bronze instead of the legacy CSV-import tables, which makes the Silver members table fully reprocessable from Bronze plus Local data. In member matching, an alias carries its source (Zoom or Slack), and the matcher returns an explicit ambiguous result when more than one member fits instead of null, so callers must handle it.",
  },
  {
    slug: "member-status-overrides-and-ambiguous-zoom-names",
    date: "2026-05-12",
    audience: "engineering",
    category: "new",
    title: "Local tables for status overrides and ambiguous Zoom names",
    summary:
      "Staff can record people who should count as active despite billing data (gifts, hiatus), and names that Zoom attendance cannot resolve to one member are tracked.",
    body: "Staff can record people who should count as active despite billing data (gifted or comped access such as a program, hosting or compensation, hiatus and other special cases) in a Local-layer source of truth, managed by an admin page and API, a source of truth like the name aliases and not derived from Bronze. Zoom display names that match several members are recorded with an upsert function so they can be resolved by hand later. A shared service-role bypass lets integration tests call protected routes without a browser session. Rule: hand-entered facts live in Local tables that processing reads and never overwrites.",
  },
  {
    slug: "kajabi-stripe-reconciliation-dashboard",
    date: "2026-05-12",
    audience: "engineering",
    category: "new",
    title: "Reconciliation dashboard comparing Kajabi and Stripe",
    summary:
      "An admin report finds members whose Kajabi status and Stripe subscription disagree, so staff know where to act.",
    body: "An admin report finds members whose Kajabi status and Stripe subscription disagree, so staff know where to act. It compares the two sources for membership offers only (payment plans and retreats are ignored on both sides) and does not flag legitimate cases: a paused Stripe subscription with an inactive Kajabi record is correct. Matching goes by email through customers to purchases by customer id, because the stored Kajabi id turned out to be stale. Tests for the overrides and reconciliation routes use the real database with the service-role helper. See docs/STRIPE_KAJABI_COMPARISON.md.",
  },
  {
    slug: "react-email-auth-templates-and-mailpit-tests",
    date: "2026-05-13",
    audience: "engineering",
    category: "new",
    title: "Branded sign-in emails built with React Email, with client-compatibility tests",
    summary:
      "The invite, confirmation, recovery, magic link and email-change emails are now React Email components with inline styles, and tests check how well they render across email clients.",
    body: [
      "Plain HTML templates lost their style blocks in Gmail, so the templates were moved to React Email, which renders inline styles. The rendered HTML stays committed in `supabase/templates/` so a fresh clone works without credentials, and `templates:render` regenerates it locally. A sync script pushes the templates to Supabase through the Management API so they stay in source control. Supabase's Go template variables are passed through as literal strings and substituted by its mailer.",
      "Tests send each email to Mailpit over its HTTP API and read its HTML check report. One suite requires 80 percent support across all clients as a regression detector; a second covers the five biggest client families (Apple Mail, Gmail, Outlook, Samsung, Yahoo) and was raised to 95 percent. The tests skip if Mailpit is not running.",
    ].join("\n\n"),
  },
  {
    slug: "hub-rename-node-pin-and-vercel-analytics",
    date: "2026-05-14",
    audience: "engineering",
    category: "improved",
    title: "Project renamed to Hedgie Hub, Node pinned, Vercel Analytics added",
    summary:
      "The admin portal became Hedgie Hub (serving members and staff), Node 24 is pinned, and page views and web vitals are tracked in Vercel.",
    body: "The admin portal became Hedgie Hub because the app serves members as well as staff; package and docs were renamed and a new domain used. Node 24 LTS is pinned in the repo and the Vercel CLI is at v54. The env sync script answers the git-branch prompt Vercel shows for preview environments. Vercel Analytics and Speed Insights are mounted in the root layout for page views and web vitals.",
  },
  {
    slug: "admin-and-member-route-groups-with-route-protection",
    date: "2026-05-14",
    audience: "engineering",
    category: "new",
    title: "Admin and member route groups, with auth required by default",
    summary:
      "The app is split into an admin area and a member area, and everything except public routes now requires a signed-in user with the right role.",
    body: "The app is split into an admin area and a member area, each with its own layout and navigation, and everything except public routes requires a signed-in user with the right role. The member area has a calendar of the member's own attendance and profile pages, and shared pieces (user menu, sign-out, week view) live in components. Middleware redirects anonymous users, skips the API (which authenticates itself) and tolerates Supabase fetch failures. A shared admin guard helper protects every non-webhook API handler. The default role is member, and row level security policies that recursed infinitely were replaced. The root redirect sends admins to the admin area and members to their calendar. See docs/RLS_SECURITY.md.",
  },
  {
    slug: "sudo-mode-signed-cookie-and-effective-identity",
    date: "2026-05-15",
    audience: "engineering",
    category: "new",
    title: "Sudo mode: admins browse as a member, via a signed cookie",
    summary:
      "An admin can view the app as a chosen member; the choice is carried in a tamper-proof cookie and a banner shows it.",
    body: "Admins can browse as a member through a signed cookie holding the admin id, the member id and an HMAC (using a secret, compared in constant time). The effective-identity helper returns the sudo'd member only when the cookie's admin id matches the signed-in user and that user is an admin; otherwise the user's own member record. It returns the member id, name, email and an is-sudo flag. Start and exit sudo are server actions, with a banner and a Sudo As entry in the user menu; exit clears the cookies unconditionally and validates the return URL. Rule: member pages resolve the member through the effective identity, never the raw auth user. See CLAUDE.md, \"Member Identity Resolution\".",
  },
  {
    slug: "streak-computation-and-member-profile-pages",
    date: "2026-05-16",
    audience: "engineering",
    category: "new",
    title: "Weekly streak computation and member profile pages",
    summary:
      "A tested streak utility counts consecutive weeks of attendance, and a member profile page shows attendance history and streaks.",
    body: "A tested utility groups join times into weeks and returns the current and longest run of consecutive attended weeks. The current streak drops to zero once the last attended week is more than a week behind, with a grace-period boundary test. The member profile page pages through all of a member's attendance, past the 1000-row limit, to compute it. Streaks have since grown sister streaks and streaks scoped to a specific prickle day and time, using each member's own time zone.",
  },
  {
    slug: "kajabi-profile-fields-in-silver-members",
    date: "2026-05-19",
    audience: "engineering",
    category: "new",
    title: "Profile photo, bio and social links carried into members",
    summary:
      "Member processing now copies a profile photo, bio and social links from Kajabi onto the member record, and profile pages show them with an initials fallback.",
    body: "Member processing copies a profile photo, bio and social links from Kajabi onto the member record, and profile pages show them with a coloured-initials fallback (a client component, since a server component cannot attach an image error handler). When several Kajabi customers share an email, the most recently updated wins. Social and photo URLs are sanitised to block javascript links, the Kajabi avatar CDN base is resolved and handles are normalised. Prickle pages share one detail page with role-aware links that respect sudo and hide attendee emails from non-admins.",
  },
  {
    slug: "feature-previews-for-admin-opt-in",
    date: "2026-06-12",
    audience: "engineering",
    category: "new",
    title: "Feature previews: admins opt in to unfinished features",
    summary:
      "A per-user table and a settings modal let admins switch on features still being built, and navigation items and pages are hidden otherwise.",
    body: "Admins can switch on features still being built from a settings modal, stored per user. A features library defines and reads them, and navigation items and pages check the flag, so unfinished work can ship to production dark. This is the origin of the feature flag system used for gradual rollouts.",
  },
  {
    slug: "member-merge-and-duplicate-detection",
    date: "2026-06-14",
    audience: "engineering",
    category: "new",
    title: "Merging duplicate members, with detection and conflict warnings",
    summary:
      "Admins can merge two member records from a member page, in bulk, or from a Merge and Fix page that finds likely duplicates.",
    body: "Admins can merge two member records from a member page, in bulk, or from a Merge and Fix page that finds likely duplicates (same normalised name or email). All entry points use one merge route, which moves attendance, activities, hiatus and override rows, hosted prickles, ambiguous-name references, name and email aliases to the kept member, copies missing external ids, deletes derived metrics (recomputed later) and removes the duplicate, in a fixed foreign-key order. When both members have different external ids the primary's wins and the response lists the conflicts. An external-conflicts hygiene page and pre-merge warnings check Kajabi, Stripe and Slack, and reprocessing cannot let a secondary Kajabi contact overwrite the primary. Dismissed duplicate groups are shared by all admins. See docs/MEMBER_MERGE.md.",
  },
  {
    slug: "zoom-history-import-and-scoped-pagination-fixes",
    date: "2026-06-13",
    audience: "engineering",
    category: "improved",
    title: "Historical Zoom import and pagination fixes for 1000-row truncation",
    summary:
      "A script loads past Zoom meetings in batches, and several admin pages and reports that silently stopped at 1000 rows now page through everything.",
    body: "A script loads past Zoom meetings in batches (limited to 2026 because of the Zoom records API), and the import has an option to skip processing. Admin pages and report routes that silently stopped at Supabase's default 1000 rows now paginate, with a pagination test for attendance. Pop-up prickles under five minutes with one attendee are skipped, and import routes call process handlers directly to avoid Vercel deployment protection. Rule: every report reads all rows. See CLAUDE.md, \"Database Query Limits\".",
  },
  {
    slug: "stable-prickle-ids-across-reprocessing",
    date: "2026-06-30",
    audience: "engineering",
    category: "fixed",
    title: "Prickle ids stay the same when calendar and attendance are reprocessed",
    summary:
      "Reprocessing used to delete and recreate prickles with new ids, breaking links and attendance; prickles are now updated in place.",
    body: "Prickle ids are stable across reprocessing, so prickle URLs are safe to link and attendance is never orphaned. Delete-and-recreate gave every run new ids; prickles now upsert on their source key (the calendar event, or for Zoom pop-ups the meeting with its start and end times), and only prickles whose source is gone are deleted. One Zoom meeting can yield several segments, so the meeting alone is not a unique key. Duplicates are merged by repointing attendance first, and reprocessability tests cover it. See docs/MEDALLION_ARCHITECTURE.md.",
  },
  {
    slug: "attendance-reprocessed-after-member-changes",
    date: "2026-06-30",
    audience: "engineering",
    category: "improved",
    title: "Attendance rebuilt when member data or aliases change",
    summary:
      "Calendar prickles and attendance are reprocessed when aliases change, so historical attendance is matched to people added later.",
    body: "Calendar prickles and attendance are reprocessed when aliases change, so historical attendance is matched to people added later and hosts re-match. Attendance matching uses email aliases and covers every member regardless of status. A members processing run schedules an attendance reprocess of the last 90 days in the background, after the response is sent, and integration tests cover that cascade. Insights pages exclude future prickles and use a median, with a sparkline based on the chosen window.",
  },
{
    slug: "membership-history-from-kajabi-billing",
    date: "2026-07-03",
    audience: "engineering",
    category: "fixed",
    title: "Membership history built only from real membership subscriptions",
    summary: "A member's membership history now ignores one-off purchases and non-membership offers, follows email aliases, and starts from the date Kajabi first created the subscription.",
    body: "A member's membership history counts only real memberships: a shared helper decides which offers count, one-off purchases and non-membership offers are ignored, and the query follows every customer id that belongs to a member's alias emails. The start date is when Kajabi first created the subscription, which matches the \"Started on\" date in Kajabi and never changes, while the effective start date Kajabi rewrites on each renewal drifts to the latest cycle. Each subscription ends where the next one starts, and only the latest falls back to its deactivation time. The history function is exported so tests call the real implementation.",
  },
  {
    slug: "auto-alias-on-kajabi-email-change",
    date: "2026-07-02",
    audience: "engineering",
    category: "new",
    title: "Old email kept as an alias when a Kajabi contact changes address",
    summary: "When a member's email changes in Kajabi, the old address is now remembered as an alias so later imports that still use it resolve to the same member.",
    body: "When a member's email changes in Kajabi, the old address is remembered as an alias so later imports that still use it resolve to the same member. Members processing matches by the Kajabi id; on seeing a different email it records the old one as an auto-detected alias and redirects existing aliases that pointed at the old canonical email to the new one, so alias chains stay consistent. A reprocessability test covers the change. This matters because Zoom, Slack and Stripe data often still carry the old address.",
  },
  {
    slug: "reconcile-crons-use-get-and-cron-secret",
    date: "2026-07-05",
    audience: "engineering",
    category: "fixed",
    title: "Nightly reconcile jobs actually run: GET handlers, cron secret, Kajabi API",
    summary: "The three daily reconcile routes failed on Vercel Cron, and the members one did nothing; both are fixed.",
    body: "The daily reconcile routes failed on Vercel Cron because cron always calls with GET and the routes only exported POST, so every run answered 405. The shared auth helper also never checked the bearer cron secret it documented; it now does, and the secret is synced to production. The members reconcile was a no-op because it reprocessed a table with no Silver dependents; it now triggers the Kajabi API sync, mirroring the calendar one, with unit tests for auth, success and error paths. Rule: scheduled routes export GET and verify the cron secret.",
  },
  {
    slug: "community-stats-and-resubscription-insights",
    date: "2026-07-06",
    audience: "engineering",
    category: "new",
    title: "Admin insight pages: Community Stats and resubscriptions",
    summary: "Two admin analysis pages landed on top of the Silver data: community writing and prickle statistics, and members who cancelled and came back.",
    body: "Community Stats shows community writing metrics, an analog-clock heatmap of when prickles happen, prickle types by session count and a date filter with year, quarter and month to date presets. A resubscriptions insight lists members who cancelled and rejoined, with a monthly cohort chart; the detection logic is a library function with integration tests that resolves email aliases and duplicate Kajabi customer ids per email before grouping purchases. The page queries the database directly rather than fetching its own API route.",
  },
  {
    slug: "calendar-sync-prunes-deleted-events",
    date: "2026-07-07",
    audience: "engineering",
    category: "fixed",
    title: "Calendar import removes events deleted from Google Calendar",
    summary: "Deleted calendar events no longer linger in the Bronze layer and turn into ghost prickles.",
    body: "The calendar sync used to only upsert, so an event deleted in Google Calendar stayed in Bronze and was reprocessed into a ghost prickle. A security-definer database function now removes rows in the synced date range whose Google event id is missing from the current response. It refuses an empty id list, so an empty Google response cannot wipe the range, and the import reports a deleted count. Only the admin-gated import route calls it, so execute is revoked from the anonymous and authenticated roles. Calendar imports accept explicit from and to dates, the import namespace replaced the sync one, and all Bronze writes use the service role.",
  },
  {
    slug: "flaky-integration-tests-stabilized",
    date: "2026-07-06",
    audience: "engineering",
    category: "fixed",
    title: "Integration suite made deterministic",
    summary: "Wrong column names, missing required fields and tests that cleaned up each other's rows were fixed.",
    body: "Integration tests that selected columns that did not exist, omitted required fields or used the wrong member status were corrected. Tests that shared far-future date ranges (2099-07) deleted each other's data and were moved apart, and a pagination test compares a differential count instead of a baseline that concurrent tests could change. Rule: tests on the shared database use isolated data and never assume global counts.",
  },
  {
    slug: "admin-users-page-roles-and-linked-profiles",
    date: "2026-07-06",
    audience: "engineering",
    category: "new",
    title: "Admin users page: invites, roles, feature previews and linked profiles",
    summary: "Admins can manage portal users in one place: invite, change role, set feature previews, delete, and link a user to a staff record.",
    body: "An admin users page lists sign-in accounts with role and enabled feature previews, with inline edits, a delete that blocks self-deletion and a resend-invite button for pending users. A Linked Profiles column connects an account to its staff and member records in one update, matching the member by email, so no reprocess is needed. Route tests cover the auth guards, create, update and delete, feature-flag replace semantics and link and unlink. See docs/INVITING_USERS.md.",
  },
  {
    slug: "slack-engagement-insights",
    date: "2026-07-19",
    audience: "engineering",
    category: "new",
    title: "Slack engagement insights for admins",
    summary: "An admin page shows when Slack is busiest, which channels drive engagement and which have gone quiet.",
    body: "An admin page shows when Slack is busiest (a day-and-hour heatmap), per-channel engagement with trend sparklines, and a list of dormant channels that are candidates for archival. The stats live in one library with its own unit tests.",
  },
  {
    slug: "rls-enabled-on-exposed-tables-and-function-hardening",
    date: "2026-08-05",
    audience: "engineering",
    category: "fixed",
    title: "Row level security on 17 exposed tables, and Supabase advisories cleared",
    summary: "Tables that the public API could reach without row level security now require a signed-in user, and the remaining warning-level advisories were addressed.",
    body: "A migration enabled row level security on 17 tables in the public and bronze schemas that Supabase flagged as readable and writable with the anon key (five Slack and subscription tables had policies set in the dashboard without RLS switched on; the others had neither), with the usual authenticated-only policy. A second pass pinned the search path on six functions, moved the trigram extension into its own schema and restricted a security-definer function's execute grant. Two definer functions used by sign-up and the admin policies were deliberately left alone to avoid breaking them, and the skipped advisories are documented. See docs/RLS_SECURITY.md.",
  },
  {
    slug: "engagement-metrics-computed-from-attendance",
    date: "2026-08-23",
    audience: "engineering",
    category: "fixed",
    title: "Member engagement computed from attendance and Slack activity",
    summary: "Admin member pages now derive last attended, recent counts and risk from real data instead of static seed rows.",
    body: "Admin member pages derive last attended, recent counts and risk from real data. A shared engagement library computes last attended, 30-day and total prickle counts (distinct prickles, as the attendance design requires), an engagement score and a risk level from attendance; Slack activity from the last 30 days joins the score, capped at 100, while risk stays based on prickle recency. The earlier metrics tables were never refreshed, so every member read Never/0/low risk. Rule: engagement is computed from source data, never seeded.",
  },
  {
    slug: "slack-webhook-bronze-writes-fixed-and-daily-reconcile",
    date: "2026-08-26",
    audience: "engineering",
    category: "fixed",
    title: "Slack webhook Bronze writes repaired, plus a daily Slack reconcile job",
    summary: "Real-time Slack messages and reactions had not been stored since the webhook was built; they are now, and a nightly import backstops them.",
    body: "Real-time Slack messages and reactions had not been stored since the webhook was built: the handler wrote to a column that does not exist and never checked the result, so it logged success and triggered reprocessing on data that was never written. It now writes the right column, checks every Bronze write and skips reprocessing on failure, with a regression test. Slack was also the one integration without a reconcile cron; it now has a daily one that calls the Slack import in-process over a 90-day window, because Slack's free plan only exposes that much history. Rule: check every write result, and never rely on webhooks alone.",
  },
  {
    slug: "webhook-reprocessing-after-and-paginated-member-processing",
    date: "2026-08-27",
    audience: "engineering",
    category: "fixed",
    title: "Webhook follow-up work kept alive with after(), Bronze fetches paginated",
    summary: "Background reprocessing and notifications no longer get killed when the response is sent, and member processing reads all Bronze rows.",
    body: "Background work started inside request handlers (reprocessing after the calendar and Zoom webhooks, the feedback Slack post) could be frozen by Vercel once the response went out. It now runs inside Next.js after(), which keeps the function alive. Members processing also paginates its Bronze reads past the 1000-row Supabase limit, with a reprocessability test over more than a page of rows. Rule: anything that must finish after the response goes in after(), and every bulk read paginates.",
  },
  {
    slug: "member-status-lifecycle-and-overrides",
    date: "2026-08-26",
    audience: "engineering",
    category: "improved",
    title: "Member status lifecycle: lead, active, on hiatus, cancelled",
    summary: "Member status now separates people who never purchased from former members, and manual hiatus overrides survive reprocessing.",
    body: "Member status separates people who never purchased (lead) from former members (cancelled), alongside active and on hiatus. Before, a single inactive value mixed leads with real cancellations, and a hand-set hiatus was overwritten by the next nightly members rebuild; manual overrides are now applied as the final step of that rebuild, so they survive. A shared status badge, lead and cancelled filter tabs and dashboard counts follow from it. A trial flag was dropped because the Kajabi API does not expose trial information; trial detection uses Stripe data.",
  },
  {
    slug: "eslint-and-husky-pre-commit",
    date: "2026-08-26",
    audience: "engineering",
    category: "new",
    title: "ESLint flat config and a husky pre-commit hook",
    summary: "Linting and the pre-commit hook are now managed by the project itself rather than a hand-installed script.",
    body: "Linting uses a flat ESLint config and the pre-commit hook is managed by Husky in the repo rather than a hand-installed script. Dependency security findings were reduced by bumping the Vercel CLI and adding package overrides (audit findings from 75 to 24), and every page has a unique browser tab title through a root title template and per-page metadata.",
  },
  {
    slug: "unmatched-slack-users-and-match-suggestions",
    date: "2026-08-27",
    audience: "engineering",
    category: "new",
    title: "Data hygiene tools: unmatched Slack users and private channel access",
    summary: "Admins can match Slack accounts to members with suggested candidates and see private channels the Slack app can no longer read.",
    body: "An unmatched Slack users page lists Slack users with no member and offers one-click alias creation. The match suggestion function scores name similarity and email local parts at token level as well as whole string, so a short Slack name is not buried by a long legal name, and requires a length floor for substring matches. Active users sort first. A private-channel access check flags private channels whose Bronze row was not refreshed in the latest nightly import, as a proxy for the Slack app having lost access; it only detects, because an app cannot invite itself back. See docs/MEMBER_MATCHING.md.",
  },
  {
    slug: "feedback-widget",
    date: "2026-08-27",
    audience: "engineering",
    category: "new",
    title: "Site-wide feedback widget with screenshots",
    summary: "Signed-in users can report a bug or idea from any page, and admins review it and see it in Slack.",
    body: "Signed-in users can report a bug or idea from any page. A widget mounted in the member and admin layouts captures a viewport screenshot and posts it; admins review items on a feedback page with a one-click sudo-as-reporter button and a lightbox that closes on Escape. The Slack notification uses native file upload and runs inside after() so it is not dropped when the function freezes.",
  },
  {
    slug: "access-events-sessions-and-force-sign-out",
    date: "2026-08-27",
    audience: "engineering",
    category: "new",
    title: "Access history, session management and force sign-out",
    summary: "Admins can see when a user came back and what they visited, members can end their own other sessions, and admins can force a sign-out.",
    body: "Admins can see when a user came back and what they visited, members can end their own other sessions, and admins can force a sign-out. Middleware records one access event per authenticated request in after(), skipping prefetches; events are grouped into visits by a 30 minute gap and joined to the real auth session through a session claim. Supabase Auth cannot list or revoke a single session, so security-definer database functions scoped to the caller provide that, and sudo cannot reach a member's real session. Server clients forward the real user agent and IP so sessions show the actual device. A transient auth timeout in middleware no longer redirects to login, because the layouts re-verify the session.",
  },
  {
    slug: "member-dashboard-network-and-mobile-nav",
    date: "2026-08-27",
    audience: "engineering",
    category: "new",
    title: "Member dashboard, network view and mobile drawer navigation",
    summary: "The member area gained a dashboard landing page, a network page and a hamburger menu on small screens.",
    body: "The member area has a dashboard landing page showing the next seven days of prickles with a highlighted set (hosting, an active streak, a streak partner's usual slot) that is the post-login landing page, a network page that draws a member's streak connections as a radial SVG map, and a hamburger drawer below md in place of the permanent narrow sidebar, matched in the admin navigation. Streak week boundaries use the member's timezone instead of UTC.",
  },
  {
    slug: "prickle-picker-and-wheel-of-wonder",
    date: "2026-08-28",
    audience: "engineering",
    category: "new",
    title: "Prickle Picker recommender and Wheel of Wonder matching",
    summary: "Two feature-flagged member tools landed: a prickle recommender and a weighted random member match.",
    body: "Two feature-flagged member tools landed. The prickle picker is a pure scoring engine over historical attendance that recommends a prickle, using each prickle type's purpose, whether it suits solo work and host-tagged vibes. Wheel of Wonder weights candidates toward members with few connections and low recent Slack activity, offers only someone a live Slack presence check says is online, and counts a match as a connection only after a real back-and-forth is seen in the Slack webhook, with an admin review page. Rule: new member tools ship behind a feature preview flag.",
  },
  {
    slug: "member-managed-hosting-schedules",
    date: "2026-08-28",
    audience: "engineering",
    category: "new",
    title: "Hosting: member-managed monthly prickle schedules",
    summary: "Hosts can plan their monthly prickle schedule themselves, and admins can review and lock it.",
    body: "Hosts plan their monthly prickle schedule themselves on a hosting page, and admins review and lock a month on an admin hosts page. Row level security lets a member manage only their own rows while admins bypass it. A calendar-based bootstrap seeds the first month, and integration tests cover the API, locks and RLS rules. The logic lives in one schedules library.",
  },
  {
    slug: "writing-projects-tracking-phases",
    date: "2026-08-29",
    audience: "engineering",
    category: "new",
    title: "Writing projects tracking: projects, entries, goals and habits",
    summary: "The data model and logic for members' writing progress landed in phases.",
    body: "Members' writing progress shipped in phases. Member-owned Local-layer data (projects, dated progress entries, goals) uses row level security like the schedules, with writing routes and a dashboard widget. Progress math handles add versus set-total entries and backdating, and target goals show a par-line pace. Goals are either target or habit (streak, longest and typical streak, hit rate), shown through one component, with entry tags, per-project CSV export, a cumulative chart, a heatmap and opt-in display on the member's profile. Prickles attended is a goal measure derived from attendance and anchored to a snapshot of a schedule; re-anchoring archives the old goal and forks a new one.",
  },
  {
    slug: "member-tenure-and-join-date-derivation",
    date: "2026-08-29",
    audience: "engineering",
    category: "improved",
    title: "Member tenure derived from billing history with join date overrides",
    summary: "First join date, time as a member and hiatus handling are computed from billing data, replacing a manual spreadsheet.",
    body: "First join date, time as a member and hiatus handling are computed from billing data, replacing a manual spreadsheet, and drive the admin Hedgieversary page and hiatus touchpoints. Tenure is first joined, most recent join and active months excluding hiatus. Join date is the first real transaction; where a real trial existed it comes from the Stripe subscription's trial end, since Kajabi offers never expose trial length. One shared function decides what counts as a real membership stint, keyed by canonical email so Kajabi contact merges do not break it, and the Stripe import requests all statuses because the default omitted cancelled subscriptions. A join-date override table covers members from before the 2022 Kajabi migration. Hiatus is read from the overrides that reprocessing uses. Hedgieversary dates count time active: each hiatus and each cancel and resubscribe gap (the gaps are stored dated on the member by reprocessing) pushes out only the milestones that come after it, overlapping periods are counted once, and each merged period is rounded to calendar months once, as the staff spreadsheet does.",
  },
  {
    slug: "profile-badges-and-bookshelf",
    date: "2026-08-31",
    audience: "engineering",
    category: "new",
    title: "Badge system with automated badges and a bookshelf import",
    summary: "A generic badge model landed, with some badges computed and others awarded by admins.",
    body: "A generic badge model has badge types with levels and an append-only award log where the level derives from the award count, managed on an admin badges page. Prickle milestones and Founding Hedgie are computed on the fly from attendance and tenure and never stored; Hostess and Published Author are automated, with a Hedgie Bookshelf. Admins can see everyone who earned a badge, and retreat badge types exist. The member Profile page was renamed Settings.",
  },
{
    slug: "trial-conversion-uses-stripe-cancel-time",
    date: "2026-09-02",
    audience: "engineering",
    category: "fixed",
    title: "Trial conversion check uses Stripe's cancel time",
    summary: "Abandoned trials were being counted as real, billed memberships. The check now trusts Stripe for when a customer actually canceled.",
    body: "Whether a Kajabi purchase was a real membership stint or an abandoned trial was decided in `isRealMembershipStint` by checking that Kajabi's deactivation time came after the trial end. Kajabi keeps a mid-trial cancellation \"active\" until the trial's natural end and only then sets that time, so almost every mid-trial cancel passed the check.\n\nThe check now prefers the matching Stripe subscription's cancel time, which records the real cancel moment, and falls back to Kajabi's deactivation time only when there is no Stripe match. Checked against production data at the time, 16 purchases across 16 members moved from \"real stint\" to \"abandoned trial\", and two of them explained unexplained multi-hundred-day gaps against the manually kept anniversary list.",
  },
  {
    slug: "status-override-types-and-reconciliation-checks",
    date: "2026-09-04",
    audience: "engineering",
    category: "new",
    title: "Distinct status override types and payment-legitimacy checks",
    summary: "Membership status overrides gained separate types for the 180 Program and for people who pay Stripe directly, plus a check for Kajabi access with no payment behind it.",
    body: "Membership status overrides had one type, a gift (free membership for a window), and two cases were being forced into it, which would mislabel real revenue as comps in any comp reporting. They now have their own types: the 180 Program (a one-time cohort purchase, six months included, then cancelled rather than lead if the window lapses) and direct Stripe (a paying customer on a subscription our Kajabi sync cannot see).\n\nThe reconciliation page auto-detects direct-Stripe candidates and, as the mirror image, flags Kajabi purchases on membership offers that have no transaction or a zero amount (`/api/analyze/kajabi-grants`), so a manual grant does not become an invisible category. The Kajabi/Stripe mismatch check no longer flags customers who have several Stripe customers. The grants check found no matches in production when it was built.",
  },
  {
    slug: "program-cohort-tracking",
    date: "2026-09-04",
    audience: "engineering",
    category: "new",
    title: "Program cohorts, enrollments and Kajabi purchase matching",
    summary: "Programs such as the 180 Program became real data (programs, cohorts, enrollments) with admin pages, and staff can enroll people from a reviewed list of matching Kajabi purchases.",
    body: "Programs such as the 180 Program are real data: programs, cohorts (with start and expiry dates) and enrollments, with admin pages under `/admin/programs`. Members processing applies active enrollments: an active cohort yields `active` status, ordered before hiatus so an active hiatus still wins.\n\nStaff can enroll people from a reviewed list of matches. `lib/kajabi-cohort-matching.ts` is a pure, DB-free function that lists members whose purchases of the program's configured offers have a transaction or access-grant date inside the cohort window. It feeds a staff-reviewed bulk enroll rather than blind enrollment, because access dates can lag transaction dates by more than a week. Offer names are picked from the live Kajabi offer catalog, and email-alias resolution shared by several matchers lives in `lib/email-aliases.ts`.",
  },
  {
    slug: "membership-timeline-segments",
    date: "2026-09-05",
    audience: "engineering",
    category: "improved",
    title: "Membership timeline as one non-overlapping segment list",
    summary: "The admin membership timeline is now built by a sweep-line that merges stints, hiatuses, programs and overrides, and member status is recomputed whenever a hiatus changes.",
    body: "The admin membership timeline is built by a sweep-line that merges stints, hiatuses, program enrollments and status overrides into chronological segments (`lib/membership-timeline.ts`). One rule decides each stretch: hiatus wins, then any active source, then a gap. Concurrent programs and overrides show as secondary tags instead of extra rows, because hiatuses happen inside stints rather than after them.\n\n`lib/member-status.ts` recomputes and saves one member's status right after any hiatus change, so the badge never waits for a full processing run. Date-only values are parsed with `parseDateOnly` so they do not display a day early in zones behind UTC.",
  },
  {
    slug: "hygiene-dashboard-consolidation",
    date: "2026-09-08",
    audience: "engineering",
    category: "improved",
    title: "One data hygiene dashboard with fuzzy duplicate matching",
    summary: "Reconciliation and data hygiene were merged into one admin dashboard, and duplicate detection now scores fuzzy name matches.",
    body: [
      "Reconciliation duplicated two hygiene checks (Slack and Zoom orphans) with different scoping, and Merge and Fix claimed fuzzy duplicate detection but only matched exactly. The per-member reconciliation table moved into `/admin/hygiene`, the duplicated read-only lists became links to the real tools, and the dashboard was reorganized into Pipeline, Identity, Duplicate and Completeness sections.",
      "`lib/text-similarity.ts` and `lib/member-duplicates.ts` add confidence-scored fuzzy name matching; Unmatched Zoom Names gets ranked suggestions (shared with prickle detail pages); the External Conflicts tile shows a real count (`lib/external-conflicts.ts`). Slackbot was excluded from the Slack user queries on 2026-09-14.",
    ].join("\n\n"),
  },
  {
    slug: "activity-log-for-crm-signals",
    date: "2026-09-09",
    audience: "engineering",
    category: "new",
    title: "Activity log for attendance, outreach and logins",
    summary: "The member activity table now mirrors prickle attendance, outreach touches and sign-ins, so one table can answer what a member has been doing.",
    body: "The member activity table mirrors prickle attendance, outreach touches and sign-ins, so one table can answer what a member has been doing. Prickle attendance is mirrored atomically as part of its reprocess, outreach touches are backfilled, and sign-in events come from `lib/processing/login-events.ts` through `/api/reconcile/logins`, scheduled in `vercel.json`.\n\n`lib/member-engagement.ts` reads from the activity table instead of recomputing from each source. Design: `docs/ACTIVITY_AND_AUDIT_LOG.md`. Attendance reprocessability and Slack reprocess tests cover the mirror.",
  },
  {
    slug: "member-user-id-identity-link",
    date: "2026-09-14",
    audience: "engineering",
    category: "fixed",
    title: "members.user_id becomes the durable login link",
    summary: "A member's login link was silently wiped on every Kajabi reprocess. It is now preserved and used first when working out who is signed in.",
    body: "A member's login link was overwritten on every Kajabi reprocess, because the processing payload only carried it through staff records. The staff-to-member link is now a maintained foreign key, and members processing keeps an existing login link. `getEffectiveIdentity` (`lib/sudo.ts`) resolves by that link first, which survives email changes, and falls back to email for older accounts.\n\nThe admin Users page has a Member picker independent of the Staff picker, since most people given login access are paying members. An editable legal name is pushed to Kajabi's contact record so a full reprocess does not overwrite it, and a default pen name comes from `lib/member-display-name.ts`.",
  },
  {
    slug: "member-awards-table",
    date: "2026-09-15",
    audience: "engineering",
    category: "new",
    title: "member_awards table and self-reported award flow",
    summary: "Members can record outside awards and competition wins, modelled on the bookshelf self-report flow.",
    body: "Members can record outside awards and competition wins, modelled on the bookshelf self-report flow: a server action (`app/(member)/awards/actions.ts`), `AwardFormModal` and a panel on the Projects page, with validation in `lib/awardValidation.ts`. Each win posts to a staff Slack channel through `notifyStaffNewAward` in `lib/slack.ts`, gated on a channel environment variable.",
  },
  {
    slug: "supabase-auth-email-via-resend",
    date: "2026-09-18",
    audience: "engineering",
    category: "improved",
    title: "Supabase auth emails sent through Resend, config as code",
    summary: "Production auth email settings are declared in config.toml and applied with supabase config push instead of a custom sync script.",
    body: "Production auth email settings are declared in `supabase/config.toml` under `[remotes.prod]`: SMTP through Resend and the email template settings. They are applied with `supabase config push` (`pnpm config:diff` previews, `pnpm config:push` applies), which replaced a custom sync script. A push only writes declared settings, so undeclared ones keep their dashboard values. Email footers carry a support line and are sent from a no-reply sender, and the local mail section is `[local_smtp]`. Detail: CLAUDE.md, \"Supabase config as code\".",
  },
  {
    slug: "health-check-and-uptime-monitoring",
    date: "2026-09-22",
    audience: "engineering",
    category: "new",
    title: "Health check endpoint, Sentry and Checkly uptime monitoring",
    summary: "A public health endpoint, error reporting and uptime plus certificate checks now watch the production site.",
    body: "The health route (`/api/health`) queries Supabase so an external monitor learns the database is reachable, not just that Next.js answers. It adds Server-Timing output and an optional `?timing=1` breakdown (DNS, TCP, TLS, warm repeat query) for chasing slow Supabase calls after idle periods. Checkly monitors are code in `__checks__/`: an uptime check on the health route and an SSL check with a 14-day expiry warning, both every 10 minutes from two regions, deployed by `.github/workflows/checkly.yml` (`checkly test` on pull requests, `checkly deploy` on pushes to main, filtered to paths that affect the checks). Sentry reports errors in every environment, and its local-variable capture is off because the Node inspector it attaches added about 800 ms to every server render on Vercel (a login render went from roughly 850 ms to 40 ms).",
  },
  {
    slug: "ci-test-build-migrate-deploy-pipeline",
    date: "2026-09-23",
    audience: "engineering",
    category: "new",
    title: "CI pipeline: test, push migrations, then deploy",
    summary: "Merges to main now run tests, apply database migrations and only then deploy, so new code never goes live before its schema.",
    body: [
      "`.github/workflows/ci.yml` (merged 2026-09-22) starts a local Supabase stack, builds, starts the app and runs the unit and database suites, then pushes pending migrations to production on main. `docs/CI_MIGRATION_ORDERING.md` weighs two options: leave Vercel's own git deploy running (a minutes-long window where code can hit a table that does not exist yet, as an earlier segments page outage did) or gate the deploy on CI. On 2026-09-23 Option B was adopted and Vercel's auto-deploy on main was switched off in `vercel.json`.",
      "On 2026-09-24 the deploy hook (which triggers a separate remote build and reports success the moment the hook is accepted) was replaced by `vercel pull`, `vercel build --prod` and `vercel deploy --prebuilt --prod`, so the exact commit that passed tests is the one deployed and a bad build fails the job. `.next/cache` is restored with `actions/cache`. Preview deployments still come from Vercel's git integration.",
    ].join("\n\n"),
  },
  {
    slug: "ci-speed-and-registry-fixes",
    date: "2026-09-23",
    audience: "engineering",
    category: "improved",
    title: "Faster CI and workarounds for Docker registry rate limits",
    summary: "CI start-up work now overlaps the build and pulls images from Docker Hub, cutting the database job from about six minutes to about two and a half.",
    body: "CI start-up work overlaps the build: `supabase start` is backgrounded and awaited after the production build, and CI builds with Turbopack. On \"Test (db) and build\" that took the job from 6m4s to 2m29s (some of it runner variance). Pulls from ghcr.io hit rate limits, so CI authenticates, retries with backoff, and forces the Supabase CLI to pull its local images from Docker Hub via `SUPABASE_INTERNAL_IMAGE_REGISTRY` set at step level. Runners are pinned to ubuntu-24.04 and the Stripe API version pin matches the SDK.",
  },
  {
    slug: "nextjs-16-and-turbopack",
    date: "2026-09-23",
    audience: "engineering",
    category: "improved",
    title: "Upgrade to Next.js 16 and Turbopack production builds",
    summary: "The app moved from Next.js 15 to 16.3.6, with Turbopack as the production compiler.",
    body: "The app runs on Next.js 16 with Turbopack as the production compiler (`next build --turbopack`). `middleware.ts` became `proxy.ts`, the removed `eslint.ignoreDuringBuilds` option is gone, and `ci.yml` has an explicit lint step because `next build` no longer lints. React Compiler hook rules from `eslint-config-next` are set to warn.\n\nTurbopack's shared first-load JavaScript is about 38 kB larger on every route, and `/admin` and `/projects/[id]` carry an extra 90-100 kB because it inlines a copy of recharts' `AreaChart` into each route chunk where webpack shares one. That cost is bounded to two authenticated routes and accepted.",
  },
  {
    slug: "env-vars-manifest",
    date: "2026-09-25",
    audience: "engineering",
    category: "improved",
    title: "env-vars.config.ts as the single list of environment variables",
    summary: "Three sync scripts each kept their own hardcoded variable list. They now read one manifest.",
    body: [
      "`sync-to-vercel`, `sync-to-github` and `sync-vault-secrets` were bash scripts with separate lists that drifted apart, so some variables were missing from `.env.example`. `env-vars.config.ts` now declares each variable's destinations (Vercel environments, GitHub secret or variable, Supabase Vault) and whether it is secret; the scripts were rewritten in TypeScript on top of it, including the missing-value validation. `.env.example` and the env files were regrouped by system, and a secret rotation runbook was added.",
      "The manifest records an incident lesson that the Vercel sync enforces: variables always sync with `--type config`, because Vercel's default sensitive type can never be read back (even by `vercel pull`) and a sensitive `NEXT_PUBLIC_*` value is inlined into the client bundle as a placeholder string. A bug where `npx` resolved the wrong `vercel` binary because of PATH shadowing was fixed too.",
    ].join("\n\n"),
  },
  {
    slug: "my-prickles-hub-and-member-nav",
    date: "2026-09-24",
    audience: "engineering",
    category: "new",
    title: "My Prickles page and navigation built around intentions",
    summary: "The member navigation collapsed from about ten items to Home, My Burrow and Community, with a My Prickles page composed of tabs, including a full recurring schedule.",
    body: "The member navigation is Home, My Burrow (My Writing, My Prickles, Streaks) and Community (Wheel of Wonder, Bookshelf, Events), with the profile in the account menu. My Prickles is one page of tabs: attendance history, the prickle picker, hosting and All Prickles. All Prickles (`lib/prickle-schedule.ts`) groups every recurring slot by type, day of week and hour, shows who hosts next and a historical average attendance, in the viewer's zone, as a table or a calendar that also shows past prickles. The dashboard's upcoming-prickle ranking lives in `lib/upcoming-prickles.ts` so both pages share it. My Writing has Projects, Books and Awards tabs. The member layout and settings page resolve feature flags for members, not only admins.",
  },
  {
    slug: "prickle-commitments-with-slots",
    date: "2026-09-27",
    audience: "engineering",
    category: "new",
    title: "Commitments cover several slots and rank in Upcoming",
    summary: "A commitment can now hold several recurring slots, chosen from the All Prickles table or calendar, and committed prickles rank as a personal signal in Upcoming.",
    body: "A commitment can hold one or more recurring slots, chosen from the All Prickles table or calendar. An upcoming prickle that is a week of the viewer's active commitment gets its own ranking tier just under hosting and above streaks (priorities are named `PRIORITY` constants), using `computeCommitmentProgress` in `lib/commitments.ts`. Creating a commitment with its slots is one atomic database function, and an overlap check replaces the one-active-commitment-per-slot rule so renewals are allowed. Row-level security follows the `current_member_id()` and `is_admin()` convention, covered by `tests/api/commitments/rls.test.ts`. Detail: `docs/COMMITMENTS.md`.",
  },
  {
    slug: "host-eligibility-first-join-rule",
    date: "2026-09-26",
    audience: "engineering",
    category: "improved",
    title: "Hosting eligibility counted from first join and enforced on the server",
    summary: "The one-full-month rule before hosting now counts from a member's first join, and ineligible sign-ups are refused server-side.",
    body: "The one-full-month rule before hosting counts tenure from a member's first join (falling back to the most recent join), so rejoiners after a cancel or hiatus do not wait again. `requestToHost` rejects ineligible members with a shared `hostEligibilityMessage` and no insert; members who already hosted or have a confirmed schedule are exempt. The admin Add Schedule form looks up the host email on blur and warns before saving, and `GET /api/members?email=` returns host eligibility for exact lookups. The profile Hosting card uses a SQL aggregate instead of paging every attendee row.",
  },
  {
    slug: "row-level-security-audit",
    date: "2026-09-26",
    audience: "engineering",
    category: "fixed",
    title: "Row-level security audit: writes, reads and self-promotion closed",
    summary: "A policy audit closed gaps where any signed-in member could write to admin tables, read other members' private rows, or make themselves an admin.",
    body: "A policy audit of `public` and `bronze` closed three gaps: any signed-in member could write to admin tables, read other members' private rows, or make themselves an admin.\n\n- **Self-promotion:** a trigger rejects changes to a profile's role, email or id unless the caller is an admin or a privileged database role (a column-level revoke would also have blocked admins, who change roles from their own session). Test: `tests/api/admin/user-profiles-role-escalation.test.ts`.\n- **Writes:** about 45 tables whose write policies only checked for an authenticated user became admin-only (`is_admin()`) or owner-or-admin (`current_member_id()`). A member's own update to their member record is limited to name and birthday.\n- **Reads:** other members' rows are read through `member_directory`, a trigger-synced view of public profile fields. Member records are readable only for one's own row or by admins, bronze and admin note tables are admin-read, and activity reads are own-rows. Member pickers no longer send every member's email to the browser.\n\nDetail: `docs/RLS_SECURITY.md`.",
  },
  {
    slug: "admin-route-protection-and-role-claim",
    date: "2026-09-26",
    audience: "engineering",
    category: "new",
    title: "Admin routes protected in the proxy and next to the data",
    summary: "Admin pages and actions are checked at three layers, and the access token carries a role hint so the proxy needs no database read.",
    body: "Admin pages and actions are checked at three layers, per the Next.js authentication guide. `proxy.ts` makes an optimistic role check for `/admin`; `requireAdminPage()` runs in the admin layout and every admin page (layouts do not stop a page segment rendering); each admin server action calls `requireAdminAction()`. Signed-in non-admins go to a terminal `/no-access` page, which avoids a redirect loop for users without a member record. Conformance tests fail if an admin page or action skips its check.\n\nA Supabase custom access token hook writes the role into an `app_role` claim (not `role`, which PostgREST uses as the database role), so the proxy reads it from the already verified token with no database read. The claim is only as fresh as the token, so real authorization still reads the profile role. The hook omits the claim rather than blocking sign-in. CI pushes `supabase/config.toml` after migrations, so the hook function exists before the config that references it. A pgTAP test covers the hook. Detail: CLAUDE.md, \"Admin Route Protection\".",
  },
  {
    slug: "data-table-sorting-and-pagination",
    date: "2026-09-26",
    audience: "engineering",
    category: "new",
    title: "Shared table sorting and pagination, All Members paged in SQL",
    summary: "One hook now sorts and auto-paginates tables, and the admin members list pages in the database instead of loading everyone.",
    body: "One hook sorts and auto-paginates tables. `lib/pagination.ts` parses page, page size (capped at 100) and whitelisted sort columns, and decides where paging happens: server-side for sources that can pass 1000 rows, client-side for bounded tables, none for a single 50-row page. `useDataTable` combines sorting with auto-pagination above 50 rows, `useServerDataTable` is the URL-backed server mode, and `DataTablePager` renders the footer only when needed. The admin members list is paged and filtered in the database by SQL functions instead of loading every member, the whole attendance history and 30 days of activity, which an unpaginated select would also have capped silently at 1000. Empty values sort as a true reversal.",
  },
  {
    slug: "member-profile-overrides-and-trackbear-import",
    date: "2026-09-25",
    audience: "engineering",
    category: "new",
    title: "Member profile overrides and TrackBear import",
    summary: "Members' own bio and social links are stored in the Hub and win over Kajabi, and writing projects can be imported from a TrackBear export.",
    body: "Members' own bio and social links are stored in the Hub and win over Kajabi, whose API cannot write a customer's public bio or socials. One row per member, with own-row row-level security and HTTP(S) and 1000-character bio checks. Members processing prefers a non-empty override field by field, matching on Kajabi id then email, and reprocesses when it changes. `lib/social-links.ts` validates handles and URLs.\n\nWriting projects can be imported from TrackBear's data export on the Projects page (`/api/projects/import/trackbear`): projects, progress entries, starting balances, covers, tags and single-project goals. What Hub cannot represent is listed in the result. An external id, unique per member, makes re-imports idempotent. Upload was chosen because TrackBear has no OAuth and its API needs a member-made key.",
  },
{
    slug: "hub-welcome-dashboard",
    date: "2026-09-28",
    audience: "product",
    category: "new",
    title: "A dashboard that shows what is coming up",
    image: {
      src: "/changelog/hub-welcome-dashboard/01-dashboard.webp",
      alt: "The dashboard with a welcome, a Continue watching card, a How did it go? card and the first upcoming prickles.",
    },
    summary:
      "Open the Hub and see the prickles coming up in your next seven days, plus the writing goals you have starred.",
    body:
      "Your dashboard greets you by name and lists the next few prickles, with a link to find more when the week is empty. Star a writing goal on its project page and it shows here too, so your progress is one glance away.\n\nTimes are shown in your own time zone.\n\n[Open your dashboard](/dashboard)\n\n![The dashboard with a welcome, a Continue watching card, a How did it go? card and the first upcoming prickles.](/changelog/hub-welcome-dashboard/01-dashboard.webp)",
  },
  {
    slug: "browse-and-find-prickles",
    date: "2026-09-28",
    audience: "product",
    category: "new",
    title: "Browse every prickle, or let the Hub help you find one",
    image: {
      src: "/changelog/browse-and-find-prickles/01-all-prickles.webp",
      alt: "The All Prickles tab listing the weekly schedule by day with kind, host and typical turnout.",
    },
    summary:
      "My Prickles has tabs for what is coming up, every prickle on the schedule, and a short guide that helps you pick a prickle that suits you.",
    body:
      "In [My Prickles](/my-prickles) you can:\n\n- see the prickles coming up\n- browse All Prickles on the schedule, as a calendar or a table\n- use Find a Prickle to answer a few questions and get a suggestion\n- open any prickle to see what it is and who hosts it\n\n![The All Prickles tab listing the weekly schedule by day with kind, host and typical turnout.](/changelog/browse-and-find-prickles/01-all-prickles.webp)",
  },
  {
    slug: "attendance-history",
    date: "2026-09-28",
    audience: "product",
    category: "new",
    title: "Your attendance history",
    image: {
      src: "/changelog/attendance-history/01-attendance-month.webp",
      alt: "My Attendance in the month view, with the prickles attended shown on their days.",
    },
    summary:
      "Look back at the prickles you have attended, month by month on a calendar or as a list you can sort.",
    body:
      "The Attendance History tab in [My Prickles](/my-prickles/history) shows each prickle you joined, with its date and time. Switch between a month calendar and a list, and open any prickle for details.\n\n![My Attendance in the month view, with the prickles attended shown on their days.](/changelog/attendance-history/01-attendance-month.webp)",
  },
  {
    slug: "streaks-page",
    date: "2026-09-28",
    audience: "product",
    category: "new",
    title: "Streaks: celebrate showing up week after week",
    image: {
      src: "/changelog/streaks-page/01-streaks.webp",
      alt: "The Streaks page with an attendance streak, prickle streaks and streaks with other members.",
    },
    summary:
      "See how many weeks in a row you have joined a prickle, your best run so far, and the streaks you keep with a particular prickle or with another Hedgie.",
    body:
      "[Streaks](/streaks) shows three things:\n\n- your attendance streak, current and best, counted in weeks\n- Prickle Streaks, for attending the same prickle week after week\n- Sister Streaks, for showing up alongside the same Hedgie\n\nMiss a week and the streak starts again, so the page nudges you when it is time to begin a new one.\n\n![The Streaks page with an attendance streak, prickle streaks and streaks with other members.](/changelog/streaks-page/01-streaks.webp)",
  },
  {
    slug: "hosting-prickles",
    date: "2026-09-28",
    audience: "product",
    category: "new",
    title: "Host prickles and plan your hosting month",
    image: {
      src: "/changelog/hosting-prickles/01-hosting.webp",
      alt: "The Hosting tab with hosting stats and a Request to host button.",
    },
    summary:
      "If you host prickles, a Hosting tab lets you plan which weekly prickle times you take and see how your hosting is going.",
    body:
      "Hosts get a Hosting tab in [My Prickles](/my-prickles/hosting) with their schedule for the month and their hosting numbers. Hosts can also add a short note about the feel of their prickles in Settings, and a Hedgie's profile shows the prickles they host.\n\n![The Hosting tab with hosting stats and a Request to host button.](/changelog/hosting-prickles/01-hosting.webp)",
  },
  {
    slug: "my-writing-projects",
    date: "2026-09-28",
    audience: "product",
    category: "new",
    title: "My Writing: projects, goals and progress",
    image: {
      src: "/changelog/my-writing-projects/01-projects.webp",
      alt: "My Writing with project cards showing word counts and goal progress bars.",
    },
    summary:
      "Keep your projects in one place, set goals, log how much you wrote, and watch your progress on charts.",
    body:
      "In [My Writing](/projects) you can:\n\n- add a project and set goals for it\n- log your progress, by day, with a note\n- see charts of how the project is going\n- star a goal to show it on your dashboard\n- bring in progress you have been tracking in TrackBear\n\nEverything on this page is what you enter yourself.\n\n![My Writing with project cards showing word counts and goal progress bars.](/changelog/my-writing-projects/01-projects.webp)",
  },
  {
    slug: "books-and-awards",
    date: "2026-09-28",
    audience: "product",
    category: "new",
    title: "Your books and awards, and a Bookshelf for the whole community",
    image: {
      src: "/changelog/books-and-awards/02-bookshelf.webp",
      alt: "The Hedgie Book Shelf with covers, authors, genres and prices, and genre filters above.",
    },
    summary:
      "Add your published books and awards to your page, and browse the Hedgie Bookshelf to find what other members have published.",
    body:
      "Add books (with cover, description and a link to buy) and awards under the Books and Awards tabs of [My Writing](/projects). The [Bookshelf](/bookshelf) lists the books Hedgies have published, newest first, so you can discover and cheer on each other.\n\n![The Hedgie Book Shelf with covers, authors, genres and prices, and genre filters above.](/changelog/books-and-awards/02-bookshelf.webp)\n\n![My Writing, Books tab listing two books with their editions and prices.](/changelog/books-and-awards/01-my-books.webp)",
  },
  {
    slug: "wheel-of-wonder",
    date: "2026-09-28",
    audience: "product",
    category: "new",
    title: "Wheel of Wonder: meet a Hedgie who is here right now",
    image: {
      src: "/changelog/wheel-of-wonder/01-wheel-of-wonder.webp",
      alt: "The Wheel of Wonder with its empty wheel and a Spin the Wheel button.",
    },
    summary:
      "Give the wheel a spin and it picks a Hedgie who is online right now, leaning toward people who could use a new connection.",
    body:
      "Spin the [Wheel of Wonder](/wheel-of-wonder) when you would like some company. It shows who it picked and a conversation starter, and the page keeps a running count of the new connections the community has made.\n\n![The Wheel of Wonder with its empty wheel and a Spin the Wheel button.](/changelog/wheel-of-wonder/01-wheel-of-wonder.webp)",
  },
  {
    slug: "settings-and-profile",
    date: "2026-09-28",
    audience: "product",
    category: "new",
    title: "Settings: your profile, names, time zone and look",
    image: {
      src: "/changelog/settings-and-profile/01-identity.webp",
      alt: "Settings, Identity with the Real Name, Display Name and pen names fields.",
    },
    summary:
      "Make your profile yours, choose a light or dark look, set your time zone and manage where you are signed in.",
    body:
      "[Settings](/settings) has these tabs:\n\n- Account, with your email and the places you are signed in, and a button to sign out of the others\n- Profile, with your bio and links to Instagram, Facebook and X\n- Identity, with your name, birthday and the other names you are known by\n- Preferences, with a light, dark or automatic look and your time zone\n\n![Settings, Identity with the Real Name, Display Name and pen names fields.](/changelog/settings-and-profile/01-identity.webp)",
  },
  {
    slug: "personal-calendar-feed-and-commitments",
    date: "2026-09-27",
    audience: "product",
    category: "new",
    title: "Your prickles in your own calendar, and commitments across several weekly prickle times",
    image: {
      src: "/changelog/personal-calendar-feed-and-commitments/01-commitments.webp",
      alt: "The Commitments tab with a Sync your prickles with your calendar card, buttons for Google, Apple and Outlook calendars and a copy link, above an active commitment covering two weekly prickle times.",
    },
    summary:
      "Add the prickles you host, commit to or add by hand to your own calendar with a private calendar link, and make a commitment that covers more than one weekly prickle time.",
    body: [
      "Each member now has a private calendar link that works with Google Calendar, Apple Calendar and Outlook. It shows the prickles you host, the ones you have committed to, and any prickle or event you add yourself, with a 15 minute reminder.",
      "On /my-prickles you will find the calendar card, with copy link and generate new link. Use Add to my calendar on a prickle row, a prickle page or an upcoming event to add just that one or every week.",
      "A commitment can now cover several weekly prickle times. In All Prickles, tick the times you want, then pick the weeks and a start date. The Commitments tab shows your progress on each one.",
      "![The Commitments tab with a Sync your prickles with your calendar card, buttons for Google, Apple and Outlook calendars and a copy link, above an active commitment covering two weekly prickle times.](/changelog/personal-calendar-feed-and-commitments/01-commitments.webp)",
    ].join("\n\n"),
  },
  {
    slug: "member-directory-and-profile-notes",
    date: "2026-09-28",
    audience: "product",
    category: "new",
    title: "Member directory, Ask me about topics and private notes",
    summary:
      "Search the Hedgies in the new Members page, share what you love to talk about on your profile, and jot private notes about people you meet.",
    image: { src: "/changelog/member-directory-and-profile-notes/01-members-directory.webp", alt: "The Members page with a search box above a grid of member cards, each with a photo, name and bio." },
    body: [
      "![The Members page with a search box above a grid of member cards, each with a photo, name and bio.](/changelog/member-directory-and-profile-notes/01-members-directory.webp)",
      "The /members page lists current Hedgies with their bio, Ask me about topics and the writing projects they chose to show on their profile. Search matches names, bios, projects, topics and your own notes, and clicking a topic searches for it.",
      "Add your own Ask me about topics under Profile in Settings (/settings/profile).",
      "On someone else's profile you now have a My notes card for things you want to remember. Only you can see your notes.",
    ].join("\n\n"),
  },
  {
    slug: "writing-goal-titles-and-status",
    date: "2026-09-28",
    audience: "product",
    category: "improved",
    title: "Writing goals: titles, profile visibility and clearer status",
    summary:
      "Goals can have a title and description, and you choose whether each shows on your profile. Finished goals now say Achieved or Ended instead of Behind pace.",
    body: [
      "- Give a writing goal a title and a description. Both show on its card.",
      "- Choose Show on my profile for each goal and project. Your profile lists every one you chose to show.",
      "- A goal that reaches its target says Achieved, and one whose end date passed without reaching it says Ended. Pace is only shown while a goal is active.",
      "- Fixed: other members could not see the project you chose to show on your profile.",
      "![A project with an achieved goal and a goal behind pace, each with its title and description](/changelog/writing-goal-titles-and-status/01-goals.webp)",
    ].join("\n"),
    image: { src: "/changelog/writing-goal-titles-and-status/01-goals.webp", alt: "A project page with goal cards that have titles and descriptions: one marked Behind pace and one marked Achieved" },
  },
  {
    slug: "sign-in-from-slack",
    date: "2026-09-29",
    audience: "product",
    category: "new",
    title: "Sign in to the Hub from Slack",
    image: { src: "/changelog/sign-in-from-slack/01-slack-home-sign-in.webp", alt: "Billie Bot's Home tab in Slack with the Open Hedgie Hub button." },
    summary:
      "Open the Hedgie Hub straight from Slack, without waiting for an email link.",
    body: [
      "![Billie Bot's Home tab in Slack with the Open Hedgie Hub button.](/changelog/sign-in-from-slack/01-slack-home-sign-in.webp)",
      "Billie Bot, our Slack helper, has a Home tab and a /hub command with an Open Hedgie Hub button that signs you in. Each link works once and lasts about an hour.",
      "Slack on iPhone opens links in its own browser, so you can also ask for a link to copy and open in Safari, or paste the code on the login page.",
      "An invited person who asks for a sign-in link on the login page gets the invite again.",
    ].join("\n\n"),
  },
  {
    slug: "check-ins-and-prickle-picker",
    date: "2026-10-02",
    audience: "product",
    category: "new",
    title: "Say how you feel before and after a prickle",
    image: {
      src: "/changelog/check-ins-and-prickle-picker/01-prickle-picker-feelings.webp",
      alt: "The Prickle Picker's How are you feeling? step with overall and energy scales, a feeling search and an intention list.",
    },
    summary:
      "Tell us how you are feeling and what you need before a prickle, and how it went afterwards. The Prickle Picker can use your answers to suggest prickles.",
    body: [
      "Every prickle page has a Check in card. Pick up to two feelings for how you are coming in and one thing you need, such as momentum, deep focus, accountability, company or a push to get unstuck. Once the prickle has started you can also rate how it went and how you feel now. Every question is optional, and only you and the Hub admins can see your answers.",
      "The Prickle Picker now starts with How are you feeling? Your answer suggests a mood and the picks follow. Once you have rated at least two similar prickles, it also favors the kinds of prickle you rated higher than your usual.",
      "There is no AI in the Prickle Picker, and nothing in it reads your writing. The part that gets personal only looks at your own past check-in ratings of similar sessions.",
      "![The Prickle Picker's How are you feeling? step with overall and energy scales, a feeling search and an intention list.](/changelog/check-ins-and-prickle-picker/01-prickle-picker-feelings.webp)",
    ].join("\n\n"),
  },
  {
    slug: "link-writing-to-prickles",
    date: "2026-10-02",
    audience: "product",
    category: "improved",
    title: "Link your writing progress to the prickle you wrote in",
    image: {
      src: "/changelog/link-writing-to-prickles/01-log-progress.webp",
      alt: "The Log Progress window with a During which prickle? picker beneath the project, measure and date.",
    },
    summary:
      "When you log progress you can say which prickle it was during, and your dashboard reminds you about writing prickles you have not logged.",
    body: [
      "- The Log Progress window has a During which prickle? picker for the prickles on that day. If you attended just one, it is chosen for you.",
      "- A prickle page shows Your writing in this prickle, and project pages show which prickle an entry was written during.",
      "- If you have a writing project, your dashboard has a What did you write? card listing recent prickles with nothing logged. Log from it, or use the x to dismiss one you would rather skip.",
      "- Fixed: an evening prickle no longer defaults the entry to the next day.",
      "",
      "![The Log Progress window with a During which prickle? picker beneath the project, measure and date.](/changelog/link-writing-to-prickles/01-log-progress.webp)",
    ].join("\n"),
  },
  {
    slug: "check-in-and-check-out-dms",
    date: "2026-10-03",
    audience: "product",
    category: "new",
    title: "Slack reminders to check in before a prickle and check out after",
    summary:
      "Billie Bot, our Slack helper, messages you shortly before a prickle to ask how you are feeling, and afterwards to ask how it went. You choose whether you get these, and where.",
    body: [
      "Before a prickle you get a short message asking how you are feeling coming in, and afterwards one asking how it went. Each links to the check-in or check-out itself.",
      "Choose which messages you get, and whether they come by Slack or in the Hub, under Notifications in Settings (/settings/notifications). Check-out is available on the prickle page once the prickle starts.",
      "The Slack bot is now named Billie Bot (Hedgie Hub), so searching for hub finds it.",
      "![Prickle check-ins and check-outs in Notifications settings](/changelog/check-in-and-check-out-dms/01-check-in-settings.webp)",
    ].join("\n\n"),
    image: { src: "/changelog/check-in-and-check-out-dms/01-check-in-settings.webp", alt: "Settings, Notifications, with the Prickle check-ins and Prickle check-outs rows and their channel toggles" },
  },
  {
    slug: "getting-started-tour",
    date: "2026-10-03",
    audience: "product",
    category: "new",
    title: "A Getting started tour for new members",
    summary:
      "A checklist walks new members through setting up their details, introducing themselves, setting a writing goal and finding a prickle.",
    image: { src: "/changelog/getting-started-tour/01-getting-started.webp", alt: "The Getting started checklist open in the corner of the dashboard with 0 of 6 steps done." },
    body: [
      "![The Getting started checklist open in the corner of the dashboard with 0 of 6 steps done.](/changelog/getting-started-tour/01-getting-started.webp)",
      "A Getting started checklist appears in the corner of the page for accounts under 30 days old. At each step a spotlight shows you the setting to use. Check your details covers your name, birthday, pen names and other email addresses.",
      "Finished steps can be revisited, and you can restart the tour from the user menu.",
    ].join("\n\n"),
  },
  {
    slug: "in-the-hub-notifications",
    date: "2026-10-03",
    audience: "product",
    category: "new",
    title: "Notifications inside the Hub",
    summary:
      "A bell in the header and a notifications inbox keep your check-ins and other messages in the Hub, with a banner for anything time sensitive.",
    body: [
      "Messages can now arrive In the Hub as well as Slack: a bell in the header with the latest few, and a full list at /notifications. A banner appears for what is worth acting on right now, such as a check-in before the prickle starts.",
      "![The notifications inbox listing a check-in and a check-out](/changelog/in-the-hub-notifications/01-inbox.webp)",
      "A notification counts as read once you open it, dismiss its banner or answer it. You can mark messages unread again and use Edit multiple to mark many as read or unread.",
    ].join("\n\n"),
    image: { src: "/changelog/in-the-hub-notifications/01-inbox.webp", alt: "The Notifications page listing an unread check-in and a read check-out, with Mark read and Mark unread links" },
  },
  {
    slug: "week-2026-10-03-small-fixes",
    date: "2026-10-03",
    audience: "product",
    category: "fixed",
    title: "Fixes to sign-in, notification settings and the dashboard",
    summary:
      "A handful of fixes to sign-in, notification settings and the dashboard.",
    body: [
      "- If the email you sign in with is different from the email on your membership, you can save changes to your account again.",
      "- On the sign-in page, the two Slack paste boxes are now one, and the iPhone instructions start with what to do on an iPhone.",
      "- Each notification row shows its channels as small logo switches.",
      "- On your dashboard, the project title is larger than the goal in Writing Goals.",
      "- Each Settings tab now has its own web address, such as /settings/notifications.",
    ].join("\n"),
  },
  {
    slug: "check-in-from-attendance-history",
    date: "2026-10-04",
    audience: "product",
    category: "improved",
    title: "Check in and out from your attendance history",
    image: {
      src: "/changelog/check-in-from-attendance-history/01-attendance-history.webp",
      alt: "Attendance History as a list, each prickle row with Check in and Check out buttons.",
    },
    summary:
      "Attendance History now has check-in and check-out buttons for each prickle, and Find a Prickle always gives you something to consider.",
    body: [
      "- Each row in Attendance History at /my-prickles/history has Check in and Check out buttons, and upcoming prickles have a Check in button. Checking out also lets you log progress for your projects.",
      "- The check-out has a star rating, and the progress questions take numbers.",
      "- Attendance History opens as a list, 25 rows at a time.",
      "- Find a Prickle always suggests something, and says what does not match what you asked for. The feelings question now comes last and is optional.",
      "",
      "![Attendance History as a list, each prickle row with Check in and Check out buttons.](/changelog/check-in-from-attendance-history/01-attendance-history.webp)",
    ].join("\n"),
  },
  {
    slug: "week-2026-10-05-fixes",
    date: "2026-10-05",
    audience: "product",
    category: "fixed",
    title: "Fractions, check-out links and simpler check-in options",
    summary:
      "Fractional amounts, check-out links and a lighter set of check-in options.",
    body: [
      "- Progress and goal amounts can now be fractions.",
      "- The check-out message links to the check-out, not the check-in.",
      "- Check-in options were trimmed: fewer feelings, and Gentle is folded into Company.",
      "- Messages from Billie Bot, our Slack helper, no longer show a big preview under the link.",
    ].join("\n"),
  },
  {
    slug: "email-notifications",
    date: "2026-10-10",
    audience: "product",
    category: "new",
    title: "Get notifications by email",
    summary:
      "You can now choose email for any kind of Hub message, and every email has an unsubscribe link.",
    body: [
      "Under Notifications in Settings (/settings/notifications), turn on email for the messages you want. Email is off until you choose it. Each email has a link to stop that kind of message.",
      "![Notifications settings with an email toggle on each kind of message](/changelog/email-notifications/01-notification-settings.webp)",
    ].join("\n\n"),
    image: { src: "/changelog/email-notifications/01-notification-settings.webp", alt: "Settings, Notifications, with a Slack, in-Hub and email toggle on each kind of message" },
  },
  {
    slug: "notification-framework",
    date: "2026-10-03",
    audience: "engineering",
    category: "new",
    title: "Notification framework with per-kind channels",
    summary:
      "Automatic messages go through one framework with per-kind, per-channel settings for each member.",
    body: [
      "Each kind of message is registered in lib/notifications/registry.ts and sent through createNotifier in lib/notifications/notify.ts, which honors member opt-outs. Delivery adapters live in lib/channels/ (Slack, then in-app and email). A message can be marked time sensitive until a given time, and each channel decides what that means. Admin Test Notifications sends every kind on every channel. Related product entries: check-in and check-out messages, notifications inside the Hub, and email notifications.",
    ].join("\n\n"),
  },
  {
    slug: "env-config-layering",
    date: "2026-10-02",
    audience: "engineering",
    category: "improved",
    title: "Config split between app.config.ts and layered env files",
    summary:
      "Shared deployment config moved into a committed app config, and secrets are layered across shared, preview and production env files.",
    body: [
      "Values that are the same everywhere live in app.config.ts and are read through lib/config.ts. Secrets use .env.shared with .env.preview and .env.prod overrides, synced by the env:sync scripts. Analytics tracking is production only, and Sentry events are tagged by environment.",
    ].join("\n\n"),
  },
  {
    slug: "slack-manifest-from-ci",
    date: "2026-10-02",
    audience: "engineering",
    category: "improved",
    title: "Slack app manifest pushed from CI",
    summary:
      "The Slack app configuration is now code, pushed after each production deploy when it changes.",
    body: [
      "slack-app-manifest.yml is the source of truth and scripts/slack-manifest.ts pushes it after the production deploy, and only when it has changed.",
    ].join("\n\n"),
  },
  {
    slug: "activity-log-and-audit",
    date: "2026-10-06",
    audience: "engineering",
    category: "new",
    title: "Audit log and central Activity Log",
    summary:
      "Admin changes and member actions are recorded in one audit log with readable rows and per-record history.",
    body: [
      "The Activity Log page is admin only. The audit log records the net effect of a transaction rather than every intermediate write, and has a Hide system toggle. See docs/ACTIVITY_AND_AUDIT_LOG.md.",
    ].join("\n\n"),
  },
  {
    slug: "slack-bronze-capture",
    date: "2026-10-07",
    audience: "engineering",
    category: "improved",
    title: "Richer Slack capture with soft deletes",
    summary:
      "Group DMs, channel membership history, custom emoji and files are captured, deletions are marked rather than removed, and Slack message content is service role only.",
    body: [
      "Slack Bronze tables use a deleted_at column for removed messages and reactions, and aging out of the import window is never treated as deletion. Message text is readable only with the service role, admins read metadata through a view, and restricted channels are managed by admins. Activities rebuild one week per call to stay inside the statement timeout.",
    ].join("\n\n"),
  },
  {
    slug: "chat-mirror-tables",
    date: "2026-10-09",
    audience: "engineering",
    category: "new",
    title: "Chat mirror tables and live updates",
    summary:
      "A mirror of Slack conversations is projected from Bronze and updated live over Realtime, with posting back to Slack through an outbox.",
    body: [
      "Row-level security gates content separately from channel metadata. Posts from the Hub go to Slack through an outbox with retries, and are credited to their author in activity and Wheel of Wonder. See docs/SLACK_BRIDGED_CHAT.md and the Hub Chat product entry.",
    ].join("\n\n"),
  },
  {
    slug: "instagram-and-profile-links",
    date: "2026-10-12",
    audience: "product",
    category: "improved",
    title: "Instagram on your profile",
    image: { src: "/changelog/instagram-and-profile-links/01-profile-links.webp", alt: "Settings, Profile with the Instagram field filled in beside Facebook and X." },
    summary:
      "The Instagram field in Settings is now a link like Facebook and X, and it shows the handle your profile really links to.",
    body: [
      "![Settings, Profile with the Instagram field filled in beside Facebook and X.](/changelog/instagram-and-profile-links/01-profile-links.webp)",
      "Under Settings, Profile, the Instagram field shows the handle your profile points to.",
    ].join("\n\n"),
  },
  {
    slug: "universal-search",
    date: "2026-10-15",
    audience: "product",
    category: "new",
    title: "Search everything from the header",
    summary:
      "Search the Hub from the header to find members, prickles, events, pages and each settings section, with filters you can type.",
    image: { src: "/changelog/universal-search/01-search-results.webp", alt: "The search box open over the dashboard with the letters will typed, listing a matching member under Members." },
    body: [
      "Press the search box in the header (or Cmd or Ctrl K) to find members, prickles, events, pages and each section of Settings. Filters such as from: narrow results to one person, and you can limit by kind or by how recent something is. The filter bar is one compact row that wraps on a small screen instead of scrolling sideways.",
      "![The search box open over the dashboard with the letters will typed, listing a matching member under Members.](/changelog/universal-search/01-search-results.webp)",
      "Recent searches can be removed with the x. On phones the search fills the screen, and a full results page is at /search.",
    ].join("\n\n"),
  },
  {
    slug: "whos-coming-to-prickles",
    date: "2026-10-15",
    audience: "product",
    category: "new",
    title: "See who is coming to upcoming prickles",
    image: {
      src: "/changelog/whos-coming-to-prickles/01-whos-coming.webp",
      alt: "An upcoming prickle's page with a Who's coming card listing the host and a member who added it to their calendar.",
    },
    summary:
      "An upcoming prickle now shows who is planning to be there, and you can choose not to be listed.",
    body: [
      "On a prickle that has not started, the page shows Who's coming: the host, plus members who committed to it or added it to their calendar. It is a friendly sign of who is planning to join, not a reservation.",
      "![The Who's coming card on an upcoming prickle](/changelog/whos-coming-to-prickles/01-whos-coming.webp)",
      "Prefer not to be listed? Turn it off under Settings, Profile. You will still see yourself, marked as hidden from others. A prickle nobody has joined yet says to stay tuned instead of showing a zero.",
    ].join("\n\n"),
  },
  {
    slug: "add-to-calendar-from-upcoming",
    date: "2026-10-15",
    audience: "product",
    category: "improved",
    title: "Add a prickle to your calendar from the Upcoming list",
    image: {
      src: "/changelog/add-to-calendar-from-upcoming/01-upcoming-calendar-icon.webp",
      alt: "The Upcoming tab of My Prickles, a list of prickles with a small calendar icon at the right of each one.",
    },
    summary:
      "Each prickle in My Prickles, Upcoming has a calendar icon, so you no longer have to open it first.",
    body: [
      "The icon opens the same menu as the prickle page: just this one, or every week. A prickle you host or committed to shows why it is already on your calendar. Find it in [My Prickles](/my-prickles).",
      "![The Upcoming list with a calendar icon beside each prickle](/changelog/add-to-calendar-from-upcoming/01-upcoming-calendar-icon.webp)",
    ].join("\n\n"),
  },
  {
    slug: "getting-started-newcomer-steps",
    date: "2026-10-15",
    audience: "product",
    category: "improved",
    title: "Getting started: steps for newcomers",
    summary:
      "The Getting started tour now has steps for saying hello, scheduling your first prickle and adding prickles to your calendar. It is on for everyone.",
    image: { src: "/changelog/getting-started-newcomer-steps/01-getting-started.webp", alt: "The Getting started checklist listing Introduce yourself, Join a prickle and Sync your calendar among its steps." },
    body: [
      "![The Getting started checklist listing Introduce yourself, Join a prickle and Sync your calendar among its steps.](/changelog/getting-started-newcomer-steps/01-getting-started.webp)",
      "",
      "- Say hello in the intro channel on Slack (for members in their first 90 days). It checks off when you post there.",
      "- Schedule your first prickle, using the calendar icon in Upcoming.",
      "- Add your prickles to your calendar app, using the private calendar link card on Commitments. It checks off once your calendar app has picked up your link.",
      "- The goal form now explains the difference between a Target and a Habit, and new goals start pinned to your dashboard and shown on your profile (you can untick either).",
    ].join("\n"),
  },
  {
    slug: "start-a-new-streak-nudge",
    date: "2026-10-15",
    audience: "product",
    category: "improved",
    title: "A kinder nudge when a streak lapses",
    image: {
      src: "/changelog/start-a-new-streak-nudge/01-seedling-badge.webp",
      alt: "Upcoming prickles with a seedling badge on a Plot or Plan Prickle, its tooltip reading Start a new streak: you hit 2 weeks in a row here, beat your best.",
    },
    summary:
      "The sad broken-heart badge on upcoming prickles is now a seedling that invites you to start a new streak.",
    body: [
      "Where a prickle used to show a broken heart for a streak you had lost, it now shows a seedling and says how many weeks in a row you reached there, with a nudge to beat your best.",
      "![A seedling badge on an upcoming Plot or Plan Prickle, with its tooltip about your 2 weeks in a row](/changelog/start-a-new-streak-nudge/01-seedling-badge.webp)",
    ].join("\n\n"),
  },
  {
    slug: "time-zone-choices",
    date: "2026-10-18",
    audience: "product",
    category: "improved",
    title: "Clearer time zone settings",
    image: {
      src: "/changelog/time-zone-choices/01-time-zone-settings.webp",
      alt: "Settings, Preferences with the Primary time zone picker showing Eastern Time.",
    },
    summary:
      "Time zone settings are clearer: your current location is always one click away, and the prompt no longer pops up right after you pick a zone yourself.",
    body: [
      "- The Settings time zone list no longer has an auto-detect option that did not stick. Your Hub keeps a real time zone and still offers to switch when it sees you are somewhere else.",
      "- Your browser's current zone is always in the list, with a Use current location button to return to it.",
      "- Picking a zone in Settings no longer immediately asks whether to change it, and the dropdown updates right away when you answer Yes.",
      "",
      "![Settings, Preferences with the Primary time zone picker showing Eastern Time.](/changelog/time-zone-choices/01-time-zone-settings.webp)",
    ].join("\n"),
  },
  {
    slug: "zoom-meeting-id",
    date: "2026-10-18",
    audience: "product",
    category: "improved",
    title: "Join details for the prickle room",
    image: {
      src: "/changelog/zoom-meeting-id/02-join-details.webp",
      alt: "The check-in window after checking in, saying Checked in, with the meeting ID, the passcode and a Join the prickle button.",
    },
    summary:
      "The check-in window, the Slack check-in message and your private calendar link now include the prickle room's Zoom link, meeting ID and passcode.",
    body: [
      "Instead of hunting for the link, you get a Join button with the passcode in the check-in window and in the Slack check-in message. Each prickle in your private calendar link also has the link, meeting ID and passcode in its description. This is for the main prickle room.",
      "![The check-in window after checking in, with the meeting ID, passcode and a Join the prickle button](/changelog/zoom-meeting-id/02-join-details.webp)",
    ].join("\n\n"),
  },
  {
    slug: "on-air-light",
    date: "2026-10-19",
    audience: "product",
    category: "new",
    title: "On air light",
    image: {
      src: "/changelog/on-air-light/01-on-air-popover.webp",
      alt: "The red On air light in the header with 5 Hedgies at the table, opened to a card with the running prickle, its host, who is in the room, a Join on Zoom button, the meeting ID and the passcode.",
    },
    summary:
      "A light in the header shows when the prickle room has people in it and how to join.",
    body: [
      "When people are at the table, a red On air light blinks beside the bell with a count. Click it to see the prickle and its host, who is in the room, and the Zoom link with meeting ID and passcode. When the room is empty the light is grey, and the same link is offered as a way to start a pop-up prickle.",
      "![The red On air light with 5 Hedgies at the table, opened to the prickle, who is in the room and the Zoom link](/changelog/on-air-light/01-on-air-popover.webp)",
      "A grey Off air light means nobody is at the table, and its button starts a pop-up prickle.",
      "![The grey Off air light opened to a card saying nobody is at the table, with a Start a PUP on Zoom button, the meeting ID and the passcode](/changelog/on-air-light/02-off-air-popover.webp)",
    ].join("\n\n"),
  },
  {
    slug: "display-name-and-identity",
    date: "2026-10-20",
    audience: "product",
    category: "new",
    title: "Choose your display name",
    summary:
      "Settings now says which name the community sees, and you can pick one of your pen names or write your own as your display name.",
    image: { src: "/changelog/display-name-and-identity/01-identity-settings.webp", alt: "The Identity tab in Settings with Real Name, Display Name, Pen Names and Email Aliases sections." },
    body: [
      "On [Identity](/settings/identity) the sections now run Real Name, Display Name, Pen Names, Email Aliases and Birthday. Your Real Name is for your account and records. Your Display Name is what other members see.",
      "![The Identity tab in Settings with Real Name, Display Name, Pen Names and Email Aliases sections.](/changelog/display-name-and-identity/01-identity-settings.webp)",
      "Choose a pen name from the list or Write your own. A name already used by another member is refused. Each section is its own stop in Getting started.",
    ].join("\n\n"),
  },
  {
    slug: "connect-slack-step",
    date: "2026-10-20",
    audience: "product",
    category: "improved",
    title: "Connect Slack in Getting started",
    summary:
      "Getting started has a Connect Slack step. Once connected, reading a conversation in Slack or in the Hub marks it as read in both places.",
    image: { src: "/changelog/connect-slack-step/01-getting-started.webp", alt: "The Getting started checklist open in the corner of the dashboard, listing Check your details, Connect Slack and four more steps." },
    body: [
      "![The Getting started checklist open in the corner of the dashboard, listing Check your details, Connect Slack and four more steps.](/changelog/connect-slack-step/01-getting-started.webp)",
      "Connecting Slack (Settings, Account) means your Hub Chat messages appear under your name in Slack. Once connected, reading a conversation in one place marks it as read in the other. Connecting also makes Open Hedgie Hub in Slack find your account even if your Slack email differs from your Hub email.",
      "A tour you already finished reopens to show only the steps added since.",
    ].join("\n\n"),
  },
  {
    slug: "link-previews",
    date: "2026-10-20",
    audience: "product",
    category: "fixed",
    title: "Cleaner previews for Hub links",
    image: { src: "/changelog/link-previews/01-slack-link-preview.webp", alt: "A Hub link in Slack with its preview card: title, description and one centered picture." },
    summary:
      "A Hub link shared in Slack and elsewhere now shows one centered picture in its preview instead of an empty or cropped image.",
    body: [
      "![A Hub link in Slack with its preview card: title, description and one centered picture.](/changelog/link-previews/01-slack-link-preview.webp)",
      "We fixed the preview picture for shared Hub links so it appears and is not cropped. Slack on iPhone also no longer shows stray symbols in the preview.",
    ].join("\n\n"),
  },
  {
    slug: "member-hover-card",
    date: "2026-10-22",
    audience: "product",
    category: "new",
    title: "Hover cards for members",
    summary:
      "Point at a member's name or photo in chat or on Streaks to see their profile at a glance.",
    image: { src: "/changelog/member-hover-card/01-hover-card.webp", alt: "Pointing at a member's name on Streaks opens a small card with her photo, name and a View profile button." },
    body: [
      "![Pointing at a member's name on Streaks opens a small card with her photo, name and a View profile button.](/changelog/member-hover-card/01-hover-card.webp)",
      "The card shows their photo and name, when they became a Hedgie, up to three Ask me about topics and social links, with Message and View profile buttons. It also opens from the keyboard. On [Streaks](/streaks), sister names now link to profiles.",
    ].join("\n\n"),
  },
  {
    slug: "secondary-time-zone",
    date: "2026-10-22",
    audience: "product",
    category: "new",
    title: "Show a second time zone beside prickle times",
    image: {
      src: "/changelog/secondary-time-zone/01-second-time-zone.webp",
      alt: "Settings, Preferences with Show a secondary time zone ticked and a Secondary time zone picker below it.",
    },
    summary:
      "Settings has an option to show a second time zone, such as Eastern, beside the prickle times in your own.",
    body: [
      "Turn on Also show a second time zone under [Preferences](/settings/preferences) and pick any zone. It starts at Eastern, where prickles are announced. It is off by default, and appears next to times on upcoming prickles, events and commitments.",
      "![Settings, Preferences with Show a secondary time zone ticked and a Secondary time zone picker below it.](/changelog/secondary-time-zone/01-second-time-zone.webp)",
    ].join("\n\n"),
  },
  {
    slug: "wheel-of-wonder-message-on-slack",
    date: "2026-10-22",
    audience: "product",
    category: "improved",
    title: "Wheel of Wonder waits for you",
    image: { src: "/changelog/wheel-of-wonder-message-on-slack/01-wheel-match.webp", alt: "The Wheel of Wonder after a spin: the match, with a Message on Slack button and Spin Again." },
    summary:
      "Spinning the Wheel now only picks a match; the chat and icebreaker start when you click Message on Slack.",
    body: [
      "![The Wheel of Wonder after a spin: the match, with a Message on Slack button and Spin Again.](/changelog/wheel-of-wonder-message-on-slack/01-wheel-match.webp)",
      "Before, a spin opened a Slack chat and posted the icebreaker straight away. Now you can look at your match first, and the button says what it will do.",
    ].join("\n\n"),
  },
  {
    slug: "check-in-feeling-wheel",
    date: "2026-10-24",
    audience: "product",
    category: "improved",
    title: "Check-ins with mood scales and the Feeling Wheel",
    image: {
      src: "/changelog/check-in-feeling-wheel/01-feeling-wheel.webp",
      alt: "The mood scales and the Feeling Wheel, with Joyful chosen and its more specific feelings listed below.",
    },
    summary:
      "Check-ins now have two labeled mood scales and an optional Feeling Wheel, and check-out asks whether you got what you came for.",
    body: [
      "- Before a prickle: rate how you feel overall and your energy on labeled five-step scales, optionally pick the feeling from the Feeling Wheel (you can also search it), and choose your intention from a list.",
      "- After a prickle: say whether you got what you came for, then the same scales and the progress questions.",
      "The same questions appear in the check-in window, in Slack messages and where you log progress.",
      "",
      "![The mood scales and the Feeling Wheel, with Joyful chosen and its more specific feelings listed below.](/changelog/check-in-feeling-wheel/01-feeling-wheel.webp)",
    ].join("\n"),
  },
  {
    slug: "member-help-articles",
    date: "2026-10-24",
    audience: "product",
    category: "new",
    title: "Hedgie Help",
    summary:
      "Hedgie Help has articles on joining a prickle, planning your month, becoming a host, starting a pop-up prickle and running a prickle.",
    image: { src: "/changelog/member-help-articles/01-help-index.webp", alt: "The Hedgie Help page listing five articles, from How to join a prickle to Run a prickle." },
    body: [
      "![The Hedgie Help page listing five articles, from How to join a prickle to Run a prickle.](/changelog/member-help-articles/01-help-index.webp)",
      "Open [Hedgie Help](/help) from the question mark in the top bar beside the bell. It is also in the search. Each article walks through the real screens.",
    ].join("\n\n"),
  },
  {
    slug: "zoom-name-in-getting-started",
    date: "2026-10-24",
    audience: "product",
    category: "improved",
    title: "Getting started asks for your Zoom name",
    summary:
      "The tour explains that prickles are counted by the name Zoom shows, and refuses a name another member already uses.",
    image: { src: "/changelog/zoom-name-in-getting-started/01-zoom-name-stop.webp", alt: "The Pen Names and Zoom/Slack Names section of Identity settings highlighted, with a Getting started step asking for your Zoom name." },
    body: [
      "![The Pen Names and Zoom/Slack Names section of Identity settings highlighted, with a Getting started step asking for your Zoom name.](/changelog/zoom-name-in-getting-started/01-zoom-name-stop.webp)",
      "Change your name in Zoom to match your Real Name, or add the name you use in Zoom as a pen name. A name that is another member's pen name or real name is refused, so two members can't share one.",
    ].join("\n\n"),
  },
  {
    slug: "week-calendars-on-phones",
    date: "2026-10-24",
    audience: "product",
    category: "fixed",
    title: "Week calendars scroll on phones",
    image: {
      src: "/changelog/week-calendars-on-phones/01-week-on-phone.webp",
      alt: "All Prickles in Calendar view on a phone, the week reaching past the right edge of the screen.",
    },
    summary:
      "On a phone you can now scroll sideways to Thursday through Saturday on week calendars instead of having them cut off.",
    body: [
      "This fixes All Prickles, My Attendance and the host request form. We also made grey text easier to read in both light and dark mode, and the closed mobile menu no longer catches keyboard focus.",
      "In light mode, today's column is also easier to see.",
      "![All Prickles in Calendar view on a phone, the week reaching past the right edge of the screen.](/changelog/week-calendars-on-phones/01-week-on-phone.webp)",
    ].join("\n\n"),
  },
  {
    slug: "big-sisters-groundwork",
    date: "2026-10-15",
    audience: "engineering",
    category: "new",
    title: "Big Sisters program, behind a preview flag",
    summary:
      "Matching, volunteers, introductions and a Big Sisters page were built behind a preview flag that is not on for everyone.",
    body: "New members get a big sister for their first 30 days. Staff choose the match; arrival dates and trial outcomes are derived from membership data. Matching, volunteers, introductions and a Big Sisters page sit behind a preview flag. See `docs/BIG_SISTERS.md`.",
  },
  {
    slug: "coverage-reporting",
    date: "2026-10-14",
    audience: "engineering",
    category: "new",
    title: "Test coverage reporting",
    summary:
      "Coverage is measured, API tests run in-process so route coverage counts, and new code must meet a floor.",
    body: [
      "v8 coverage with area floors; API tests call route handlers in-process; a required Coverage report check gates patches.",
    ].join("\n\n"),
  },
  {
    slug: "usage-analytics-tracking-plan",
    date: "2026-10-20",
    audience: "engineering",
    category: "new",
    title: "Usage analytics with a tracking plan",
    summary:
      "Only declared events are stored, with funnels and a usage explorer for admins.",
    body: [
      "Events are declared in lib/analytics/events.ts and funnels in lib/analytics/funnels.ts. Members can leave usage statistics from /privacy. See docs/ANALYTICS.md.",
    ].join("\n\n"),
  },
  {
    slug: "ci-and-tooling-week-1018",
    date: "2026-10-21",
    audience: "engineering",
    category: "improved",
    title: "pnpm, auto-merge, docs-only skips and container queries",
    summary:
      "The repo moved to pnpm, new PRs auto-merge on green, docs-only changes skip tests and deploy, and layouts use named container queries.",
    body: [
      "Named container sizes live in tailwind.config.ts. A production tag marks what is deployed. Migration order is checked in pre-commit and CI.",
    ].join("\n\n"),
  },
  {
    slug: "short-ids-phase-one",
    date: "2026-10-23",
    audience: "engineering",
    category: "improved",
    title: "Short prefixed ids for Tier 1 tables",
    summary:
      "Members, prickles and other visible records moved from uuids to readable prefixed ids.",
    body: [
      "new_id(prefix) generates ids like mbr_ and prkl_, and new tables follow the same rule. Links to members and prickles use the new ids. See docs/SHORT_IDS_PLAN.md.",
    ].join("\n\n"),
  },
  {
    slug: "demo-harness",
    date: "2026-10-23",
    audience: "engineering",
    category: "new",
    title: "Demo harness and help screenshots",
    summary:
      "A separate demo stack with Playwright scenes produces the screenshots used in Hedgie Help.",
    body: [
      "Every scene also runs page checks (accessibility, overflow, console), and screenshots are published before deploy. See docs/DEMO_AND_HELP.md.",
    ].join("\n\n"),
  },
  {
    slug: "data-access-layer",
    date: "2026-10-23",
    audience: "engineering",
    category: "new",
    title: "Data access layer with repositories",
    summary:
      "Tables are queried through repositories with an in-memory twin for tests, starting with attendance.",
    body: [
      "lib/data holds an interface, a Supabase class and an in-memory class per aggregate, and tests/lib/data-access-layer.test.ts guards against new direct queries.",
    ].join("\n\n"),
  },
  {
    slug: "typed-supabase-clients",
    date: "2026-10-24",
    audience: "engineering",
    category: "improved",
    title: "Typed Supabase clients and stale-type check",
    summary:
      "Every Supabase client is typed with the generated Database, and CI fails when the generated types are stale.",
    body: [
      "pnpm types:gen regenerates lib/data/database.types.ts and pnpm types:check runs in CI.",
    ].join("\n\n"),
  },
  {
    slug: "navigation-reorganized",
    date: "2026-10-25",
    audience: "product",
    category: "improved",
    title: "Clearer navigation and a footer",
    image: { src: "/changelog/navigation-reorganized/01-sidebar.webp", alt: "The sidebar with Community and Explore groups, and the footer with Privacy and Contact us." },
    summary:
      "The sidebar now separates Community, where you take part, from Explore, where you browse, and the My prefix is gone from your own pages.",
    body: [
      "![The sidebar with Community and Explore groups, and the footer with Privacy and Contact us.](/changelog/navigation-reorganized/01-sidebar.webp)",
      "Chat, Wheel of Wonder and Big Sisters stay under Community. Members, Book Shelf and Events moved to a new Explore group. My Writing and My Prickles are now Writing and Prickles in the sidebar and search (their page headings are unchanged).",
      "The member area also has a small footer with links to Privacy and Contact us.",
    ].join("\n\n"),
  },
  {
    slug: "search-and-display-names",
    date: "2026-10-27",
    audience: "product",
    category: "improved",
    title: "Search finds the names people go by",
    summary:
      "The search box in the top bar also finds the other names a member goes by and the guest speaker of a prickle, and hosts and attendees show the name people go by.",
    image: { src: "/changelog/search-and-display-names/01-search-alternate-name.webp", alt: "The search box with Jules typed, showing the member Julia Sample with the line also known as Jules Sample." },
    body: [
      "![The search box with Jules typed, showing the member Julia Sample with the line also known as Jules Sample.](/changelog/search-and-display-names/01-search-alternate-name.webp)",
      "When a search result matches a nickname, a small line under it says so (the search on the Members page matches names as before). Hosts and attendees on prickle pages, the attendance calendar, the titles in your private calendar link and the Events page now show the name each person goes by instead of their real name.",
      "You can no longer turn your own other names on or off in Settings. Those names are how attendance gets matched to you, so switching one off could lose matches. Staff can still do it for you.",
    ].join("\n\n"),
  },
  {
    slug: "help-menu",
    date: "2026-10-27",
    audience: "product",
    category: "improved",
    title: "A help menu in the top bar",
    summary:
      "The help icon is now a menu with Hedgie Help and Send feedback.",
    image: { src: "/changelog/help-menu/01-help-menu.webp", alt: "The help menu open in the top bar, listing Hedgie Help, What's new and Send feedback." },
    body: [
      "Hedgie Help is at [/help](/help). Send feedback opens the feedback form in a panel, replacing the floating button.",
      "![The help menu open in the top bar, listing Hedgie Help, What's new and Send feedback.](/changelog/help-menu/01-help-menu.webp)",
    ].join("\n\n"),
  },
  {
    slug: "media-library-and-book-covers",
    date: "2026-10-29",
    audience: "product",
    category: "new",
    title: "Book covers at any size, from your own images",
    summary:
      "Upload a book cover at any size, pick it again from your own images and adjust its crop. We also offer a download in the size Amazon asks for, when your image is large enough.",
    body: [
      "The book form has one Choose cover button with a tab of your own images and an upload tab. Common image files and photos from your iPhone all work, up to 4 MB. The exact-size rule is gone.",
      "![The Choose a cover window with your own images](/changelog/media-library-and-book-covers/01-choose-cover.webp)",
      "Under the cover you will see a download link for the size Amazon wants, or what is missing if the image is too small. Older covers keep working but have no Amazon version until you upload them again.",
    ].join("\n\n"),
    image: { src: "/changelog/media-library-and-book-covers/01-choose-cover.webp", alt: "The Choose a cover window over the book form, with Library and Upload tabs and two of the member's own book covers" },
  },
  {
    slug: "book-genres-as-tags",
    date: "2026-10-31",
    audience: "product",
    category: "improved",
    title: "Book genres as tags you can filter by",
    summary:
      "Genres on the book form are tags, the Book Shelf can be filtered by genre, and search finds books by genre.",
    body: [
      "Add up to five genres or tropes per book. On the [Book Shelf](/bookshelf), genre chips with counts narrow the list, and clicking one again clears it.",
      "![The Book Shelf with genre chips above the books](/changelog/book-genres-as-tags/01-shelf.webp)",
    ].join("\n\n"),
    image: { src: "/changelog/book-genres-as-tags/01-shelf.webp", alt: "The Book Shelf with genre chips and counts above five books, each listing its genres" },
  },
  {
    slug: "sidebar-modes",
    date: "2026-10-30",
    audience: "product",
    category: "new",
    title: "Choose how the side menu behaves",
    summary:
      "A button in the header lets you keep the side menu open, tuck it away until you point at it, or close it. The Hub remembers your choice.",
    body: [
      "In auto-hide the sidebar rests as a slim icon rail and opens over the page when you hover or focus it, so the page does not shift. Until you choose, the sidebar auto-hides on chat and stays open elsewhere.",
      "![The Dashboard with the side menu auto-hidden as a slim icon rail](/changelog/sidebar-modes/01-auto-hide-rail.webp)",
    ].join("\n\n"),
    image: { src: "/changelog/sidebar-modes/01-auto-hide-rail.webp", alt: "The Dashboard with the side menu tucked away as a slim rail of icons" },
  },
  {
    slug: "descriptions-keep-formatting",
    date: "2026-10-30",
    audience: "product",
    category: "fixed",
    title: "Prickle and event descriptions keep their formatting",
    image: { src: "/changelog/descriptions-keep-formatting/01-prickle-description.webp", alt: "A prickle page whose description keeps bold, italic, a bullet list, a link and a dividing line." },
    summary:
      "Descriptions imported from the calendar now keep bold, italic, links, bullet lists, paragraph breaks and dividing lines instead of running together.",
    body: [
      "![A prickle page whose description keeps bold, italic, a bullet list, a link and a dividing line.](/changelog/descriptions-keep-formatting/01-prickle-description.webp)",
      "Prickles that were already imported pick up the formatting the next time the calendar refreshes.",
    ].join("\n\n"),
  },
  {
    slug: "privacy-page",
    date: "2026-10-30",
    audience: "product",
    category: "improved",
    title: "A clearer privacy page, and a switch for usage statistics",
    summary:
      "The privacy page opens with a short summary and can be read without signing in. A switch lets you stop the Hub recording how you use it, and removes what was already recorded about you.",
    body: [
      "[/privacy](/privacy) now covers what we collect, who can see it, chat and messages, how long we keep things, your choices and the services we use.",
      "![The top of the privacy page: a short summary, then a table of what we collect](/changelog/privacy-page/01-privacy.webp)",
      "Turn off Share usage statistics and the Hub stops recording your usage and removes the usage events already stored under your account. Error recordings, used to fix crashes, continue.",
    ].join("\n\n"),
    image: { src: "/changelog/privacy-page/01-privacy.webp", alt: "The top of the privacy page: a short summary, then a table of what we collect" },
  },
  {
    slug: "projects-past-and-delete",
    date: "2026-10-31",
    audience: "product",
    category: "improved",
    title: "Set-aside projects, deleting, and goals that ended",
    summary:
      "Projects you have set aside are listed apart from the ones you are working on, you can delete a project from its details, and goals that ended unmet no longer show as a standing score.",
    body: [
      "On My Writing, projects you have set aside move to a collapsed Hibernating section, apart from the ones you are working on. They still open as usual, and changing a project's status brings it back.",
      "![My Writing with the current projects and a collapsed section for a set-aside project](/changelog/projects-past-and-delete/01-past-projects.webp)",
      "Delete is in the project's Edit details. Its goals and entries go with it, and a book published from it stays on the shelf. Deleted items are kept until you ask us to remove them, as [/privacy](/privacy) explains.",
      "A goal whose end date passed before its target now moves to Past goals on the project page and leaves the project list, the dashboard and your profile.",
      "Deleting a project hides it. We keep a copy until you ask us to remove it.",
    ].join("\n\n"),
    image: { src: "/changelog/projects-past-and-delete/01-past-projects.webp", alt: "My Writing listing current projects, with a collapsed section below holding a set-aside project" },
  },
  {
    slug: "fixes-2026-10-31",
    date: "2026-10-31",
    audience: "product",
    category: "fixed",
    title: "Cleaner event names, a working past-events page and tabs that refresh",
    summary:
      "Cleaner event names, a past-events page that works, and tabs left open across an update reload themselves.",
    body: [
      "- Event names drop the calendar's label and category and keep who the event is with.",
      "- The past events page no longer crashes.",
      "- A tab left open while the Hub updates now reloads instead of failing on its next action.",
    ].join("\n"),
  },
  {
    slug: "course-builder",
    date: "2026-10-31",
    audience: "engineering",
    category: "new",
    title: "Course editor for Hub-owned courses, first parts",
    summary:
      "Staff can create and edit a course in the Hub, add, rename, duplicate, delete and reorder modules and lessons, and play a lesson's video in the builder.",
    body: [
      "This is staff-only and not visible to members yet. Reorders write a single audit entry with the order before and after. Courses are read and written through CourseRepository and CourseProgressRepository.",
    ].join("\n\n"),
  },
  {
    slug: "google-calendar-live-sync",
    date: "2026-10-28",
    audience: "engineering",
    category: "improved",
    title: "Google Calendar syncs from push notifications",
    summary:
      "The calendar sync opens and renews its push channel on its own and syncs only what changed.",
    body: [
      "Deletions outside the watched window are caught, and the admin calendar refreshes itself when the sync changes prickles. See CalendarSyncStateRepository in lib/data/calendar-sync-state.ts.",
    ].join("\n\n"),
  },
  {
    slug: "data-layer-rollout",
    date: "2026-10-31",
    audience: "engineering",
    category: "improved",
    title: "More tables behind repositories, and migration safety",
    summary:
      "Courses, billing, events, books, Zoom, Slack and the people and profile tables moved behind repositories, and a check now fails migrations that drop or rename what live code still uses.",
    body: [
      "The guard test parses the source and fails on a new direct query. Squawk runs in the Check migrations job, so removals ship in two pull requests: stop using it, then drop it.",
    ].join("\n\n"),
  },
  {
    slug: "alerts-and-monitoring",
    date: "2026-10-30",
    audience: "engineering",
    category: "improved",
    title: "Alerts for crashes, failing page sections and monitors",
    summary:
      "The team is alerted when a page crashes in the browser, a page section fails or times out, or a synthetic monitor fails.",
    body: [
      "Section failure alerts link to the error search. Video playback has a nightly end-to-end check and its configuration lives in code, and the error-tracking organization settings are now code too.",
    ].join("\n\n"),
  },
  {
    slug: "privacy-retention",
    date: "2026-10-30",
    audience: "engineering",
    category: "improved",
    title: "Privacy retention job and usage rollups",
    summary:
      "A nightly job removes exact IP addresses and browser strings after 90 days, and usage events are rolled up into totals before older ones are removed after 13 months.",
    body: [
      "The device type is parsed once when a visit is recorded and kept, along with the approximate place. Usage rollups are built from now; nothing reaches 13 months until late 2027. Session Replay for ordinary visits follows consent and the usage-statistics switch, while error-only recording stays on. This backs the promises on [/privacy](/privacy).",
    ].join("\n\n"),
  },
  {
    slug: "chat-open-to-everyone",
    date: "2026-11-01",
    audience: "product",
    category: "new",
    major: true,
    title: "Hub Chat: our Slack conversations, in the Hub",
    summary:
      "Read and join our Slack conversations from the Hub, reply under a message, react, share files and format your messages. What you write here appears in Slack too.",
    image: {
      src: "/changelog/chat-open-to-everyone/01-conversation.webp",
      alt: "The chat page showing a channel with threads and reactions",
    },
    body: [
      "Hub Chat brings our Slack conversations into the Hub, and it is now open to every member.",
      "Chat is in the sidebar under Community. It lists the conversations you are in first, with a Browse channels button for the public channels you could join, and a lock on private ones. Conversations, replies and reactions update on their own.",
      "![The chat page showing a channel with threads and reactions](/changelog/chat-open-to-everyone/01-conversation.webp)",
      "- Write messages and replies in the Hub and they appear in Slack. By default Billie Bot, our Slack helper, posts them with your name and photo. Connect your Slack account under Account in Settings and they appear under your own name in Slack; you can disconnect at any time from the same place.",
      "- A message that Slack has not accepted after a few retries is marked as failed, so you can see it did not go through.",
      "- Edit or delete your own messages, and the change reaches Slack too.",
      "- Attach files with the paperclip, paste an image or drag it in. Images show right in the conversation, and they reach Slack too.",
      "- Pick from a full emoji picker, mention people with @ and channels with #, and format your message with bold, italics, lists and more. Unsent text is kept as a draft for each conversation.",
      "- Each day has a marker, times follow your time zone, and Copy link on a message gives a link that opens right on it.",
      "![The chat message box with its formatting toolbar and a quote being written](/changelog/chat-open-to-everyone/02-message-box.webp)",
    ].join("\n\n"),
  },
  {
    slug: "events-open-to-everyone",
    date: "2026-11-01",
    audience: "product",
    category: "new",
    title: "Events in the Hub",
    image: { src: "/changelog/events-open-to-everyone/01-events.webp", alt: "The Events page: special events and educational sessions as picture cards, with November at a glance below." },
    summary:
      "See what is coming up, with a picture on each event and a month-at-a-glance list that shows the time of day.",
    body: [
      "Events are now open to every member in the Hub.",
      "![The Events page: special events and educational sessions as picture cards, with November at a glance below.](/changelog/events-open-to-everyone/01-events.webp)",
      "At [/events](/events), upcoming special events and educational sessions sit on top as picture cards. Below them, pick this month, next month or the one after to see everything by day, with times shown in your own time zone.",
      "Past events have their own page at [/events/past](/events/past), a month at a time.",
    ].join("\n\n"),
  },
  {
    slug: "reminders-for-everyone",
    date: "2026-11-01",
    audience: "product",
    category: "new",
    title: "Gentle reminders to say hello and to plan a prickle",
    summary:
      "Newcomers get a nudge to say hello in the intro channel, and anyone with nothing planned can get a reminder to put a prickle on their calendar. You choose where they arrive, or turn them off.",
    body: [
      "- Introduction reminders go to members in their first 90 days who have not yet said hello in the intro channel.\n- Prickle reminders go to members with nothing on their calendar and no recent prickle. They are off until you turn them on, except in your first 90 days, and they come less often the longer they go unanswered.",
      "Choose which channels they come on, or turn them off, under [Notifications](/settings/notifications).",
      "![Notifications settings, with the introduction and prickle reminders](/changelog/reminders-for-everyone/01-reminder-settings.webp)",
    ].join("\n\n"),
    image: { src: "/changelog/reminders-for-everyone/01-reminder-settings.webp", alt: "Settings, Notifications, listing the introduction and prickle reminders with a Slack, in-Hub and email toggle on each" },
  },
  {
    slug: "courses-open-to-everyone",
    date: "2026-11-02",
    audience: "product",
    category: "new",
    major: true,
    title: "Courses in the Hub",
    summary:
      "Watch your course lessons right in the Hub, mark them complete and pick up where you left off.",
    image: {
      src: "/changelog/courses-open-to-everyone/01-courses-list.webp",
      alt: "The Courses page with three course cards, one showing progress",
    },
    body: [
      "Courses now live in the Hub, and they are open to every member.",
      "Find them under [Courses](/courses): cards with cover images and your progress, a page for each module, and lesson pages with the video, its text and downloadable files.",
      "![The Courses page with course cards and progress](/changelog/courses-open-to-everyone/01-courses-list.webp)",
      "- A lesson completes by itself when you have watched about 90 percent, or you can press Mark complete under the video. A card then points you to the next lesson.",
      "- The Hub remembers where you stopped, and your dashboard has a Continue watching card that takes you straight back to it.",
      "![The dashboard with a Continue watching card showing a lesson, its course and a progress bar.](/changelog/courses-open-to-everyone/02-continue-watching.webp)",
      "- A course you pre-ordered shows its launch date and opens on that day.",
      "- A course or lesson link shared with someone who is not signed in shows a preview with its title, a short teaser and a cover. The video and full text stay behind sign-in.",
    ].join("\n\n"),
  },
  {
    slug: "sign-in-with-an-emailed-code",
    date: "2026-11-02",
    audience: "product",
    category: "new",
    title: "Sign in with a code from your email",
    image: { src: "/changelog/sign-in-with-an-emailed-code/01-sign-in-email.webp", alt: "The sign-in email, with the Sign in button and a code to type on the sign-in page." },
    summary:
      "Your sign-in email now includes a one-time code you can type in, so signing in works even if the link opens in the wrong app.",
    body: [
      "![The sign-in email, with the Sign in button and a code to type on the sign-in page.](/changelog/sign-in-with-an-emailed-code/01-sign-in-email.webp)",
      "Go to [/login](/login), enter your email and the code from the sign-in email. The code also works if the link opens in a different browser than the one you asked from, such as a phone's mail app.",
      "If you ask for a link twice within a minute, the page now tells you one was just sent and to check your inbox.",
    ].join("\n\n"),
  },
  {
    slug: "allow-animations",
    date: "2026-11-02",
    audience: "product",
    category: "new",
    title: "Turn down moving images and motion",
    summary:
      "In Settings, Preferences, choose whether the Hub follows your device, always shows animations, or tones them down. With motion reduced, animated emoji stay still.",
    body: [
      "Find it in [Settings](/settings), under Preferences. System follows your device. With animations reduced, movement on the page stops, animated emoji show a still picture, and moving image attachments in chat play and pause when you click them. The choice is saved on this device, like the theme.",
      "![The Animations choice in Settings, Preferences](/changelog/allow-animations/01-animations-setting.webp)",
    ].join("\n\n"),
    image: { src: "/changelog/allow-animations/01-animations-setting.webp", alt: "Settings, Preferences, showing the Animations choice set to System" },
  },
  {
    slug: "check-in-and-check-out",
    date: "2026-11-02",
    audience: "product",
    category: "improved",
    title: "Check in or out at any time during a prickle",
    image: {
      src: "/changelog/check-in-and-check-out/01-running-prickle-check-out.webp",
      alt: "The Upcoming list in My Prickles with the running Progress Prickle showing both a Check in and a Check out button beside it.",
    },
    summary:
      "You can check in until a prickle ends, and the running prickle in your list now has a Check out button. You get a check-out message a few minutes before the end, and you do not need a writing goal to use either.",
    body: [
      "Check-in now stays open until the prickle ends, and it is offered if you are in the prickle's Zoom room even without a commitment or a calendar item. The check-out message comes 5 to 10 minutes before a prickle ends, so you can check out before you leave for your next thing.",
      "You no longer need a writing goal to be asked to check in or check out. Without a goal you get the usual questions, plus a short tip about setting one.",
      "![A running prickle in the Upcoming list with Check in and Check out buttons](/changelog/check-in-and-check-out/01-running-prickle-check-out.webp)",
    ].join("\n\n"),
  },
  {
    slug: "calendar-feed-one-day-events",
    date: "2026-11-02",
    audience: "product",
    category: "fixed",
    title: "Events on your calendar show at the right time",
    summary:
      "One-day events you add to your own calendar now show their real start and end time instead of sitting all day. Longer events, like retreats, stay all day.",
    body: [
      "Multi-day events, such as retreats, stay all-day. The search button in the header is also a steady square on phones instead of a clipped sliver.",
    ].join("\n\n"),
  },
  {
    slug: "my-books-multiple-formats",
    date: "2026-11-03",
    audience: "product",
    category: "improved",
    title: "One book, print and ebook",
    summary:
      "A book on your shelf can have a print edition and an ebook edition, each with its own link and price, on one card.",
    body: [
      "In the book form, switch on Print, Ebook or both. The shelf, your profile and the project card show one link per edition, such as Print $17.99 and Ebook $4.99, with genres on their own line below. Existing books keep their single edition.",
      "![My Books listing a book with Print and Ebook prices](/changelog/my-books-multiple-formats/01-my-books.webp)",
    ].join("\n\n"),
    image: { src: "/changelog/my-books-multiple-formats/01-my-books.webp", alt: "My Books with a book showing both a Print and an Ebook price on one line" },
  },
  {
    slug: "fixes-2026-11-03",
    date: "2026-11-03",
    audience: "product",
    category: "fixed",
    title: "Fixes to chat, course videos, check-in messages and sign-in",
    summary:
      "Fixes to chat, course videos, Slack check-in messages and the sign-in page.",
    body: [
      "- Chat: Enter sends a message from inside a list or code block (Shift+Enter starts the next line), and several attached pictures wrap instead of running off the pane.",
      "- Course videos say what failed and retry once if the playback link expired while the page sat open.",
      "- The Slack check-in and check-out messages have a Submit button that closes them.",
      "- The sign-in page has one Sign-in code box for an email code or a Slack code or link.",
    ].join("\n"),
  },
  {
    slug: "hub-chat-direct-messages",
    date: "2026-11-02",
    audience: "engineering",
    category: "new",
    title: "Direct messages between members, behind a feature flag",
    summary:
      "Members can start a Hub-only direct message from a profile's Message button, switched off for everyone until it is rolled out.",
    body: [
      "These conversations stay in the Hub and nothing goes to Slack. They are private and restricted, so staff can see that one exists but not its text. The chat_dms feature decides who can start one. It becomes a product entry when it is on for everyone.",
    ].join("\n\n"),
  },
  {
    slug: "slack-dm-bridge",
    date: "2026-11-03",
    audience: "engineering",
    category: "new",
    title: "Slack DM bridge, switched off",
    summary:
      "One-on-one Slack DMs can be pulled into chat for the members a feature flag covers, read with each member's own Slack token.",
    body: [
      "It has live delivery of new messages, a nightly pull, and a way to start a Slack DM from a profile's Message button. The feature is off for everyone as of this entry. /privacy describes what is read and kept, and the choice is to disconnect Slack. It becomes a product entry when it is on for everyone.",
    ].join("\n\n"),
  },
  {
    slug: "ci-speed-and-repos",
    date: "2026-11-01",
    audience: "engineering",
    category: "improved",
    title: "Faster CI and repository-based tests",
    summary:
      "Lint and type checks overlap with tests, and many tests use the in-memory repositories instead of faked database calls.",
    body: [
      "The notifier, channels, reminders and check-in messages now take repositories instead of database clients, and 176 PostgREST casts were removed by typing the boundary once. pnpm seed:local loads a typed seed profile into the local database.",
    ].join("\n\n"),
  },
  {
    slug: "launch-tooling",
    date: "2026-11-02",
    audience: "engineering",
    category: "new",
    title: "Launch tooling",
    summary:
      "Sign-in accounts were created in advance for members, then released and emailed in batches, each with its own sign-in code.",
    body: [
      "pnpm auth:precreate and pnpm launch:email did the rollout. Both default to a dry run and take --limit and --only to trial it first, and the email can be re-run safely because each sent member is marked.",
    ].join("\n\n"),
  },
  {
    slug: "removal-requests-and-community-manager",
    date: "2026-11-03",
    audience: "engineering",
    category: "new",
    title: "Member data removal routine and a Community Manager role",
    summary:
      "A routine removes a member's data on request, and a read-only Community Manager role opens a fixed set of admin pages.",
    body: [
      "The removal routine has a staff entry point and a decision for every table that holds member data. Admins can preview the admin area as a Community Manager, and new admin pages stay closed to that role until they are added on purpose.",
    ].join("\n\n"),
  },
  {
    slug: "whats-new-changelog",
    date: "2026-11-04",
    audience: "product",
    category: "new",
    title: "A changelog for the Hedgie Hub",
    summary:
      "See what is new and fixed in the Hub on a What's new page, and choose how you hear about it: a weekly roundup on Slack, in the Hub or by email.",
    body: [
      "Every improvement and fix you might notice now gets a short write-up on the [What's new](/changelog) page, newest first, each with its own link. Find it under the **?** menu in the top bar, or search for it.",
      "![The What's new page, with the latest updates](/changelog/whats-new-changelog/01-whats-new-list.webp)",
      "A weekly roundup of the new entries reaches you on the channels you choose. Slack and the Hub's own notifications are on by default; you can turn on email, or switch any of them off, under [Notifications](/settings/notifications) in Settings, in Product updates. We also post new updates in the announcements channel on Slack.",
    ].join("\n\n"),
    image: { src: "/changelog/whats-new-changelog/01-whats-new-list.webp", alt: "The What's new page, with the latest updates" },
  },
  {
    slug: "changelog-and-notification-log",
    date: "2026-11-04",
    audience: "engineering",
    category: "new",
    title: "Changelog system, weekly digest and one notification log",
    summary:
      "Changelog entries live in one typed file that feeds the What's new pages, the admin Changelog, the weekly digest and the announcements post.",
    body: "`lib/changelog/entries.ts` is the single typed source for the What's new pages, the admin Changelog, the weekly digest and the announcements post. Each entry is for the product audience (members, plus the admin Changelog) or the engineering audience (admin Changelog only). A test fails on a malformed entry or an image that is not there, and there is no generated file to keep in sync.\n\nThe weekly digest is a notification kind sent by `/api/internal/changelog-digest` from Vercel Cron (Tuesdays 14:00 UTC) behind its own feature flag, so it starts in dry run. Each member gets the entries from the last 30 days they have not had, as one message on the channels they chose, and nothing dated before `changelogDigestStartsOn` in `app.config.ts` is sent.\n\nOne shared notification log records what the app sent, keyed by recipient (a member, or a shared place such as a Slack channel), kind and dedup key. A send is claimed before it is made and released when nothing was delivered, so a retry or overlapping run never sends twice (`NotificationLogRepository`, one contract suite for both implementations). Screenshots: `pnpm changelog:capture <slug>`. Detail: `docs/CHANGELOG_PROCESS.md`.",
  },
  {
    slug: "members-search-alternate-names",
    date: "2026-11-06",
    audience: "product",
    category: "improved",
    title: "The Members page finds the names people go by",
    summary:
      "Search on the Members page now also finds a member by a nickname or pen name, and says so with a line under their name.",
    image: { src: "/changelog/members-search-alternate-names/01-members-search-alias.webp", alt: "The Members page with Jules typed in the search box, showing Julia Sample with the line also known as Jules Sample." },
    body: [
      "![The Members page with Jules typed in the search box, showing Julia Sample with the line also known as Jules Sample.](/changelog/members-search-alternate-names/01-members-search-alias.webp)",
      "Type a nickname or pen name in the Members search and the member shows up, with a small line under their name that says also known as and the name you typed. It uses the same names as the search in the top bar, so the two always agree about who a name belongs to.",
    ].join("\n\n"),
  },
  {
    slug: "admin-search-matches-all-aliases",
    date: "2026-11-06",
    audience: "engineering",
    category: "fixed",
    title: "Admin member search matches every active alias",
    summary: "The admin Members list now finds a member by any active alias, and no longer by one that has been switched off.",
    body: "The admin Members list finds a member by any active name alias and never by a switched-off one. Before, it matched only aliases from one source and ignored whether they were active, so an alias an admin added or a member wrote found nobody while a switched-off one still did. It now uses the rule the top-bar search and the member directory already share: any active name alias, with Slack-source aliases excluded because they are user ids, not names. A pgTAP test covers each alias source and a switched-off alias, and fails on the old behavior.",
  },
  {
    slug: "check-in-usual-feelings",
    date: "2026-11-06",
    audience: "product",
    category: "improved",
    title: "Your most-used feelings come first when you check in",
    image: { src: "/changelog/check-in-usual-feelings/01-frequently-used.webp", alt: "The check-in form with a Frequently used row of feelings above the Feeling Wheel" },
    summary:
      "The feelings you name most often now sit at the top of the feeling question, so naming how you feel takes one tap instead of a search through the whole Feeling Wheel.",
    body: [
      "When you check in or out, the feelings you pick most often show up first, under Frequently used. Tap one to choose it, tap it again to undo. There is nothing to set up: the list follows your own earlier check-ins, and the full Feeling Wheel is still right below it.",
      "![The check-in form with a Frequently used row of feelings above the Feeling Wheel](/changelog/check-in-usual-feelings/01-frequently-used.webp)",
      "In the Slack check-in and check-out messages your top three are listed first in the feeling menu.",
    ].join("\n\n"),
  },
  {
    slug: "searchable-member-aliases-view",
    date: "2026-11-06",
    audience: "engineering",
    category: "improved",
    title: "One definition of a searchable alias",
    summary: "The top-bar search, the Members page and the admin Members list now read the same view of name aliases, so they cannot drift apart again.",
    body: "The rule for which aliases identify a person by name lived in three SQL functions and had already diverged once. It now lives in one view that the top-bar search, the member directory and the admin Members list all read: an alias counts if it is active and is not a Slack-source alias, which is an opaque user id. The view is `security_invoker`, so row-level security applies to anyone reading it directly; the two `SECURITY DEFINER` functions run as the owner as before. A pgTAP test checks the view and that the three searches agree on active, switched-off and Slack aliases. As a side effect, the top-bar search and the Members page no longer match Slack user ids.",
  },
  {
    slug: "check-in-skip-questions",
    date: "2026-11-06",
    audience: "product",
    category: "improved",
    title: "Skip any check-in question",
    image: { src: "/changelog/check-in-skip-questions/01-skip.webp", alt: "The check-in form with a Skip button beside each question" },
    summary:
      "Every question in a check-in or check-out now has a Skip, so you can leave one out and still finish.",
    body: [
      "![The check-in form with a Skip button beside each question](/changelog/check-in-skip-questions/01-skip.webp)",
      "Not every question fits every day. On the site each question has a Skip button. In the Slack messages each one has a Skip button or a \"Skip this question\" option in its menu. A skipped question counts as done: once you have answered or skipped every question, the check-in or check-out is finished and we stop asking.",
      "Changed your mind? Pick an answer and the skip goes away, or tap Skipped again.",
    ].join("\n\n"),
  },
  {
    slug: "goals-follow-their-project-on-profile",
    date: "2026-11-07",
    audience: "product",
    category: "fixed",
    title: "Your goals and their project now show up together on your profile",
    image: { src: "/changelog/goals-follow-their-project-on-profile/01-goal-on-profile.webp", alt: "A new goal's form with Show on my profile ticked, saying other members can see the goal and its project" },
    summary:
      "A goal on your profile already showed its project's title and progress, so now a goal appears on your profile only when its project does. New projects start out on your profile.",
    body: [
      "**Worth a look:** if you had a goal on your profile but not its project, the project is on your profile now, because the goal was already showing its title and progress. If you would rather keep it to yourself, take it off from the project page. That also takes its goals off your profile.",
      "A goal on your profile has always shown the title and progress of the project it belongs to, so the two now go together: a goal can be on your profile only when its project is. Taking a project off your profile takes its goals off too, and putting the project back does not bring them back; turn each goal on again if you want it.",
      "New projects start out on your profile. You can still turn a project off on its page.",
      "![A new goal's form with Show on my profile ticked, saying other members can see the goal and its project](/changelog/goals-follow-their-project-on-profile/01-goal-on-profile.webp)",
      "We also fixed a mismatch where a goal on your profile could show less progress than your dashboard. Your profile now counts the words you started with, like your dashboard does.",
    ].join("\n\n"),
  },
  {
    slug: "settings-devices-list",
    date: "2026-11-07",
    audience: "product",
    category: "improved",
    title: "Your signed-in devices are easier to recognize",
    image: { src: "/changelog/settings-devices-list/01-devices.webp", alt: "Settings, Devices: Chrome 156 on macOS marked This device, and Safari on iPhone, each with when it was last used and where it connected from." },
    summary: "In Settings, Devices now names each one, like Chrome 156 on macOS or Safari on iPhone (iOS 18.7), so you can tell which to log out.",
    body: [
      "![Settings, Devices: Chrome 156 on macOS marked This device, and Safari on iPhone, each with when it was last used and where it connected from.](/changelog/settings-devices-list/01-devices.webp)",
      "The old Active Sessions list showed a long block of browser code. It is now called Devices and shows a plain name for each device, when it was last used, roughly where it connected from (a city and country, when we know it), and a Log out button. The device you are on is marked This device.",
      "Every device is listed, however many you have.",
      "The place is approximate, taken from the network a device connects through, so a VPN or a phone carrier can make it off. We already record it when you visit the Hub, and this list shows it back to you; your IP address is not shown. The privacy page explains how long we keep it.",
    ].join("\n\n"),
  },
  {
    slug: "chat-link-previews-and-app-cards",
    date: "2026-11-10",
    audience: "engineering",
    category: "new",
    title: "Hub Chat draws Slack's link previews and app cards",
    summary: "Messages that Slack gave a link preview, and messages posted by apps such as deploy notices, now show as cards in Hub Chat, with the app's own name and logo.",
    body: "Hub Chat draws what Slack sends natively: link previews, app messages and shared Slack messages. One parser (`parseUnfurls`, `lib/chat/unfurls.ts`) turns Slack's legacy attachments and Block Kit into a small set of typed variants (cards, blocks, shares), and renderers in `components/chat/MessageUnfurls.tsx` draw them. Apps show under their own name and logo.\n\n- **Hooks:** the parser registry (`BLOCK_PARSERS`) and the renderer registry (`BLOCK_RENDERERS`); a block type is one entry in each. Anything not understood falls back to an \"Open in Slack\" link.\n- **An app's message is drawn from its blocks; a person's message from its text.**\n- **Every picture goes through the picture proxy.**\n- **A shared Slack message** shows Slack's embedded copy to anyone who can read the sharing message.\n\nAdding a block type or unfurl kind: `docs/SLACK_BRIDGED_CHAT.md`, \"Adding a block type (or a new kind of unfurl)\".",
  },
  {
    slug: "combobox-keyboard-hook",
    date: "2026-11-17",
    audience: "engineering",
    category: "new",
    title: "One keyboard pattern for every picker",
    summary: "The member and staff pickers, single and multiple, answer the arrow keys, Enter and Escape the same way, and Ctrl/Cmd+Enter submits the form around them.",
    body: "Every dropdown under a text box now follows the WAI-ARIA combobox pattern through one hook, `useComboboxKeys` (`lib/hooks/useComboboxKeys.ts`): arrows move a highlight that the mouse shares, Enter picks, the first Escape closes the list and only the second reaches the dialog around it, and the highlight is announced with `aria-activedescendant` and scrolled into view. Focus never leaves the box.\n\n- **Rule:** never hand-write arrow-key handling for a popup list; use the hook and its options (`homeEnd`, `pickSole`, `keepHighlight`, `preselect`, `pickOnTab`).\n- **Multi-select:** Enter toggles the highlighted option and keeps the list open; with nothing highlighted it is left to the form.\n- **Ctrl/Cmd+Enter** submits the enclosing form through `submitFormOnModEnter` (`lib/submit-form-on-mod-enter.ts`), wired into `Modal`. A primary button that works this way shows `Kbd` with `onAccent`.\n\nDetail and the pickers still outside the hook: `.claude/rules/reuse-ui-components.md` and `docs/TODO.md`, \"Move The Remaining List Popups Onto `useComboboxKeys`\".",
  },
  {
    slug: "chat-jump-to-a-day",
    date: "2026-11-13",
    audience: "product",
    category: "new",
    title: "Jump to any day in a chat conversation",
    summary: "Tap the day label in a conversation to jump to today, yesterday, last week, last month, the very beginning, or any date you pick on a calendar.",
    body: [
      "In Hub Chat, the day label above each group of messages (like \"Wednesday, November 11th\") is now a button. Tap it to open Jump to... and choose Today, Yesterday, Last week, Last month or The very beginning, or pick a specific date on a calendar.",
      "![The Jump to menu opened from a day label, listing Today, Yesterday, Last week, Last month, The very beginning and a specific date](/changelog/chat-jump-to-a-day/01-jump-to-menu.webp)",
      "The conversation opens on the first message of that day. If nothing was posted that day, it opens on the next day that has messages, and tells you so. A Jump to latest link takes you back to the newest messages, and Show newer messages carries on from where the page ends.",
      "Days follow your own time zone setting. Looking back this way does not mark the conversation as read.",
    ].join("\n\n"),
    image: { src: "/changelog/chat-jump-to-a-day/01-jump-to-menu.webp", alt: "The Jump to menu opened from a day label, listing Today, Yesterday, Last week, Last month, The very beginning and a specific date" },
  },
  {
    slug: "chat-apps-section",
    date: "2026-11-15",
    audience: "product",
    category: "improved",
    title: "Apps now have their own place in the chat list",
    summary: "In Hub Chat, your private messages with apps like Billie Bot, our Slack helper, now sit under their own Apps heading, apart from the people you talk to.",
    body: [
      "Your chat list now has an Apps heading under Direct messages. A conversation with an app shows under the app's name instead of a plain \"Direct message\", so the list under Direct messages is only people.",
      "![The Hub Chat sidebar with an Apps heading under Direct messages, holding Billie Bot](/changelog/chat-apps-section/01-apps-heading.webp)",
    ].join("\n\n"),
    image: { src: "/changelog/chat-apps-section/01-apps-heading.webp", alt: "The Hub Chat sidebar with an Apps heading under Direct messages, holding Billie Bot" },
  },
];
