/**
 * What the public Compliance page (`/compliance`) lists: the laws, standards and frameworks we follow, rely on a
 * provider for, or are working toward. One place, so the page and its test read the same list.
 *
 * Every line must be true of the code today, like the privacy page. Change it with the code, and say "Not yet
 * reviewed" instead of guessing. We name no certification we do not hold: a provider's own certificate is the
 * provider's, and the row says so. Evidence for each row is in the `evidence` note (not shown to members).
 */

export const COMPLIANCE_EFFECTIVE = "2026-11-24";

export const COMPLIANCE_STATUSES = {
  inPlace: "In place",
  provider: "Handled by our provider",
  working: "Working toward",
  guide: "Used as a checklist",
  review: "Not yet reviewed",
  notApplicable: "Doesn't apply",
} as const;

export type ComplianceStatus = keyof typeof COMPLIANCE_STATUSES;

export interface ComplianceItem {
  name: string;
  /** What it is, in a few plain words. */
  about: string;
  status: ComplianceStatus;
  /** What we do about it, or what is still open. Plain sentences. */
  detail: string;
  /** Where in the app, code or docs it can be checked. Shown on the staff page (`/admin/compliance`), not to members. */
  evidence: readonly string[];
  /** When this row was last checked against the code (YYYY-MM-DD, Eastern). */
  checked: string;
  /** What is still open, in plain sentences. Empty when nothing is. */
  open: readonly string[];
}

export interface ComplianceGroup {
  id: string;
  title: string;
  intro: string;
  items: readonly ComplianceItem[];
}

/** A stable in-page id for a row, from its name: lowercase words joined by hyphens. */
export function complianceItemId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const COMPLIANCE_GROUPS: readonly ComplianceGroup[] = [
  {
    id: "privacy",
    title: "Privacy and data protection",
    intro: "How we handle your personal information. The full detail is on the Privacy page.",
    items: [
      {
        name: "GDPR and UK GDPR",
        about: "Data protection law in the EU, the EEA and the UK.",
        status: "inPlace",
        detail:
          "If you connect from the EU, EEA or UK we ask before recording usage statistics or loading analytics cookies, and we record none of that if you decline. The one exception is error recordings, which we keep to fix bugs (the Privacy page explains). You can ask us to show, correct or remove what we hold, and we answer within a month. Exact IP addresses and browser details are removed after 90 days and usage statistics after 13 months.",
        evidence: ["src/components/ConsentBanner.tsx", "src/lib/gdpr-countries.ts", "src/lib/retention.ts", "src/app/privacy/page.tsx", "tests/components/pages/privacy-page.test.tsx"],
        checked: "2026-11-18",
        open: [],
      },
      {
        name: "ePrivacy and PECR (cookies)",
        about: "Rules on cookies and similar storage in the EU and the UK.",
        status: "inPlace",
        detail:
          "Only what the Hub needs to work is stored without asking. Anything for statistics waits for a yes where the law requires one, and the Cookies section of the Privacy page lists what is kept.",
        evidence: ["src/components/ConsentBanner.tsx", "src/lib/analytics/consent.ts", "src/app/privacy/page.tsx (cookies section)"],
        checked: "2026-11-17",
        open: [],
      },
      {
        name: "EU-U.S. Data Privacy Framework, its UK extension, and standard contractual clauses",
        about: "The ways personal data legally moves from Europe to the United States.",
        status: "provider",
        detail:
          "Our database and hosting are in the United States. Our providers are certified under the Data Privacy Framework, except our database provider, which relies on standard contractual clauses in its data processing terms. We check the certification list each autumn and whenever we add a provider.",
        evidence: ["src/app/privacy/page.tsx (services section)", "docs/TODO.md (the Data Privacy Framework check)"],
        checked: "2026-11-17",
        open: ["Checked against the Data Privacy Framework list on 2026-10-30: every provider active except our database provider, which relies on standard contractual clauses. One email provider was marked \"re-certification under review\" and Google's next due date is 2027-09-13. Look them up again each autumn and whenever a provider is added."],
      },
      {
        name: "California and other US state privacy laws",
        about: "CCPA/CPRA and the similar laws in other US states.",
        status: "review",
        detail:
          "We do not sell or share your information with anyone except the services that run the Hub, and everyone, wherever they live, can ask us to show, correct or remove what we hold. We have not yet done a formal review against these laws.",
        evidence: ["src/app/privacy/page.tsx (also good to know, asking us)", "docs/TODO.md (Compliance page: rows still to review)"],
        checked: "2026-11-17",
        open: ["No formal review against CCPA/CPRA or other state laws: check the thresholds, the notices and the request process against the Privacy page, then change this row and the Privacy wording together."],
      },
      {
        name: "COPPA and children's privacy",
        about: "Protections for children under 13.",
        status: "notApplicable",
        detail:
          "The Hub is not for children under 13. If one has joined, tell us and we will delete their information.",
        evidence: ["src/app/privacy/page.tsx (children)"],
        checked: "2026-11-17",
        open: [],
      },
      {
        name: "Email rules (CAN-SPAM and similar)",
        about: "Rules for email you receive from us.",
        status: "inPlace",
        detail:
          "Notification emails, the ones you choose in Settings, are off until you turn them on. Each has an unsubscribe link for that kind of email, and mail apps that support it show their own one-click Unsubscribe button. Each also shows our mailing address at the bottom. Emails about your account, such as a sign-in link or confirming a new address, are sent because of something you did, and don't carry the unsubscribe link.",
        evidence: ["src/lib/email-unsubscribe.ts", "src/lib/channels/email.ts", "src/emails/notifications/index.tsx (postal address)", "src/lib/config.ts (postalAddress)", "tests/lib/notification-emails.test.ts", "src/app/unsubscribe", "src/app/api/email/unsubscribe/route.ts"],
        checked: "2026-11-18",
        open: [],
      },
    ],
  },
  {
    id: "payments",
    title: "Payments",
    intro: "How your membership payments are kept safe.",
    items: [
      {
        name: "PCI DSS",
        about: "The security standard for anyone who handles payment card details.",
        status: "provider",
        detail:
          "Card and bank details never reach the Hub. They are handled by our payment provider, which holds the PCI certification. The Hub only reads your plan, its dates and payment status back from the provider, and has no card form of its own.",
        evidence: ["src/lib/stripe/client.ts (list and retrieve calls only)", "no Stripe.js or checkout code anywhere in app, components or lib"],
        checked: "2026-11-17",
        open: [],
      },
    ],
  },
  {
    id: "accessibility",
    title: "Accessibility",
    intro: "Making the Hub work for as many people as we can.",
    items: [
      {
        name: "WCAG 2.1 level AA",
        about: "The Web Content Accessibility Guidelines, the common standard for accessible websites.",
        status: "working",
        detail:
          "Automated checks for WCAG 2.0 and 2.1 levels A and AA, including colour contrast, run on every page we capture, at phone, tablet and desktop sizes in light and dark. Pages built in the landing page editor are checked for headings, image descriptions and link names before they can be published. Automated checks find only part of the problems. A walkthrough by keyboard alone and with a screen reader has not been done yet, and the checks cover only some screens so far.",
        evidence: ["tests/demo/checks.ts", "src/lib/landing/a11y.ts", "docs/product/DEMO_AND_HELP.md", "docs/TODO.md (accessibility entries)"],
        checked: "2026-11-17",
        open: ["A keyboard-only walkthrough and a screen reader pass (VoiceOver on iPhone and Mac) have not been done.", "The automated checks see only the screens the demo scenes visit (about a dozen); admin pages, chat, courses and events are fixed by the sweep but unverified.", "The course video player's controls are not checked (no demo video is ready)."],
      },
      {
        name: "Reduced motion and animation choices",
        about: "Respecting people who are bothered by moving pictures.",
        status: "inPlace",
        detail: "You can choose how animations behave in the Hub, and light and dark themes are available. The choice is saved on each device for now.",
        evidence: ["src/lib/animations.ts", "src/app/(member)/settings/ThemeSwitcher.tsx", "docs/TODO.md (animations saved per device)"],
        checked: "2026-11-17",
        open: ["The animation choice is saved in the browser, so a member who relies on it must set it again on every device. Move it to the member profile and read it in the root layout."],
      },
    ],
  },
  {
    id: "security",
    title: "Security",
    intro: "How we protect the Hub and what is in it.",
    items: [
      {
        name: "Access control",
        about: "Who can see and change what.",
        status: "inPlace",
        detail:
          "Sign-in is by invitation. The database enforces who can read each row, staff access is limited by role, and admin pages check it again on every request. Connections are encrypted, and each member's chat connection is stored encrypted and used only by the Hub's server. The Security page has the detail.",
        evidence: ["src/lib/supabase/middleware.ts", "src/lib/admin-auth.ts", "src/lib/permissions.ts", "/admin/security has the full detail"],
        checked: "2026-11-17",
        open: [],
      },
      {
        name: "Browser protections (Content-Security-Policy)",
        about: "A header that tells browsers which sources a page may load from.",
        status: "inPlace",
        detail: "We send it on every page. It limits which scripts may run (only the Hub's own, and what they load), which sources pictures and styles may load from, where forms may send data, and whether other sites may show Hub pages inside their own. It also limits where a page may connect to and which frames, media and fonts it loads. We also send the headers that stop browsers guessing file types, limit what is shared when you follow a link, and keep pages from using your camera, microphone or location.",
        evidence: ["next.config.ts", "src/proxy.ts", "src/lib/csp.ts", "tests/lib/csp.test.ts"],
        checked: "2026-11-23",
        open: ["Inline style attributes are still allowed; they cannot run script (docs/TODO.md, CSP for scripts and styles)."],
      },
      {
        name: "Error monitoring and privacy",
        about: "Finding bugs without collecting more than needed.",
        status: "inPlace",
        detail:
          "Error recordings mask text and form fields, our monitoring provider scrubs sensitive data on its servers and does not store IP addresses, and its data is held in the EU. These settings are kept in the repository so a change is reviewed.",
        evidence: ["config/sentry.yml", "docs/infrastructure/SENTRY_CONFIG.md", "src/instrumentation-client.ts"],
        checked: "2026-11-17",
        open: [],
      },
      {
        name: "OpenSSF security baseline",
        about: "Public security checklists for open-source code, and a score out of 10 from a checking tool.",
        status: "guide",
        detail:
          "We use two public checklists from the OpenSSF as a guide for how we run the Hub's code. They are written for open-source projects with outside contributors, and the Hub is not one, so we are not aiming for a certificate or a badge. A checking tool from the same group also scores the code out of 10. From the checklists we took three things: every change must pass the required checks and no one can skip them, the tools that build the app are locked to exact versions, and the code that checks the links members add, such as profile links, is tested with many made-up addresses.",
        evidence: ["docs/checklists/OSPS_BASELINE.md", "docs/checklists/OPENSSF_BEST_PRACTICES.md", ".github/workflows/openssf-scorecard.yml", "config/app.ts (scorecard.minScore)", "config/github.yml", "tests/lib/url-sanitizers-fuzz.test.ts"],
        checked: "2026-11-24",
        open: ["Deliberately not pursued, because they would raise the score without making the Hub safer: a DCO or CLA (we accept no outside code), releases with signed provenance (the app deploys continuously from main), a bot approver, and the Best Practices badge (it needs an open-source license). Level 3 of the Baseline and the Code-Review check need a second human approver. The decisions and what would reopen each are in docs/checklists/OPENSSF_BEST_PRACTICES.md, Decided not to pursue."],
      },
      {
        name: "SOC 2 and ISO 27001",
        about: "Independent audits of an organization's security practices.",
        status: "notApplicable",
        detail:
          "Quill & Cup does not hold either certificate. Our hosting and database providers publish their own audit reports, which cover the infrastructure the Hub runs on.",
        evidence: ["none held by Quill & Cup; the providers' reports are the providers' own"],
        checked: "2026-11-17",
        open: ["If a customer or partner ever asks for a SOC 2 report, the answer today is that we have none and rely on our providers."],
      },
    ],
  },
];

/** The services we lean on for part of the above, and what each does for us. Full list: the Privacy page. */
export interface ComplianceProvider {
  /** The provider's name. Shown only on the staff page (`/admin/compliance`): the public page describes providers by `role`. */
  name: string;
  role: string;
  /** What they handle for compliance. */
  covers: string;
}

export const COMPLIANCE_PROVIDERS: readonly ComplianceProvider[] = [
  { name: "Stripe", role: "Payments", covers: "Card and bank details, and the PCI certification." },
  { name: "Supabase", role: "Database", covers: "Storage in the United States, under standard contractual clauses." },
  { name: "Supabase", role: "Sign-in", covers: "Signs members in and keeps their sessions. Its data is stored in the United States, under standard contractual clauses." },
  { name: "Vercel", role: "Hosting", covers: "Hosting in the United States; counts visits and page speed in aggregate, with no individual profile." },
  { name: "Sentry", role: "Error monitoring", covers: "Errors and masked recordings, kept in the EU." },
  { name: "Mux", role: "Course video", covers: "Video hosting and, only if usage statistics are on, playback quality measured without a name, email or account id and with no cookie." },
  { name: "Slack, Zoom, Google, Kajabi and our email provider", role: "Chat, live sessions, calendar, courses and email", covers: "Each is described on the Privacy page; each is listed there as a service we use." },
];
