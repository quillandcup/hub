/**
 * What the public Compliance page (`/compliance`) lists: the laws, standards and frameworks we follow, rely on a
 * provider for, or are working toward. One place, so the page and its test read the same list.
 *
 * Every line must be true of the code today, like the privacy page. Change it with the code, and say "Not yet
 * reviewed" instead of guessing. We name no certification we do not hold: a provider's own certificate is the
 * provider's, and the row says so. Evidence for each row is in the `evidence` note (not shown to members).
 */

export const COMPLIANCE_EFFECTIVE = "2026-11-17";

export const COMPLIANCE_STATUSES = {
  inPlace: "In place",
  provider: "Handled by our provider",
  working: "Working toward",
  review: "Not yet reviewed",
  notApplicable: "Not for this",
} as const;

export type ComplianceStatus = keyof typeof COMPLIANCE_STATUSES;

export interface ComplianceItem {
  name: string;
  /** What it is, in a few plain words. */
  about: string;
  status: ComplianceStatus;
  /** What we do about it, or what is still open. Plain sentences. */
  detail: string;
  /** Where in the app or docs it can be checked (for engineers; not rendered). */
  evidence: string;
}

export interface ComplianceGroup {
  id: string;
  title: string;
  intro: string;
  items: readonly ComplianceItem[];
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
          "If you connect from the EU, EEA or UK we ask before recording usage statistics or loading Google Analytics, and we record nothing if you decline. You can ask us to show, correct or remove what we hold, and we answer within a month. Exact IP addresses and browser details are removed after 90 days and usage statistics after 13 months.",
        evidence: "components/ConsentBanner.tsx, lib/gdpr-countries.ts, lib/retention.ts, app/privacy/page.tsx",
      },
      {
        name: "ePrivacy and PECR (cookies)",
        about: "Rules on cookies and similar storage in the EU and the UK.",
        status: "inPlace",
        detail:
          "Only what the Hub needs to work is stored without asking. Anything for statistics waits for a yes where the law requires one, and the Cookies section of the Privacy page lists what is kept.",
        evidence: "components/ConsentBanner.tsx, lib/analytics/consent.ts, app/privacy/page.tsx (cookies)",
      },
      {
        name: "EU-U.S. Data Privacy Framework, its UK extension, and standard contractual clauses",
        about: "The ways personal data legally moves from Europe to the United States.",
        status: "provider",
        detail:
          "Our database and hosting are in the United States. Our providers are certified under the Data Privacy Framework, except our database provider, which relies on standard contractual clauses in its data processing terms. We check the certification list each autumn and whenever we add a provider.",
        evidence: "app/privacy/page.tsx (services), docs/TODO.md entry on the Data Privacy Framework check",
      },
      {
        name: "California and other US state privacy laws",
        about: "CCPA/CPRA and the similar laws in other US states.",
        status: "review",
        detail:
          "We do not sell or share your information with anyone except the services that run the Hub, and everyone, wherever they live, can ask us to show, correct or remove what we hold. We have not yet done a formal review against these laws.",
        evidence: "app/privacy/page.tsx (also good to know, asking us); docs/TODO.md",
      },
      {
        name: "COPPA and children's privacy",
        about: "Protections for children under 13.",
        status: "notApplicable",
        detail:
          "The Hub is not for children under 13. If one has joined, tell us and we will delete their information.",
        evidence: "app/privacy/page.tsx (children)",
      },
      {
        name: "Email rules (CAN-SPAM and similar)",
        about: "Rules for email you receive from us.",
        status: "working",
        detail:
          "Every email has an unsubscribe link for that kind of email, and mail apps that support it show their own one-click Unsubscribe button. You choose which notifications you get, and where, in Settings. We still need to review the rest of the rules, such as the sender details in each email.",
        evidence: "lib/email-unsubscribe.ts, lib/channels/email.ts, app/unsubscribe, docs/TODO.md",
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
          "Card and bank details never reach the Hub. They are handled by our payment provider, Stripe, which holds the PCI certification. The Hub only reads your plan, its dates and payment status back from Stripe, and has no card form of its own.",
        evidence: "lib/stripe/client.ts (list and retrieve calls only), no Stripe.js or checkout code",
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
        evidence: "demo/checks.ts, lib/landing/a11y.ts, docs/DEMO_AND_HELP.md, docs/TODO.md",
      },
      {
        name: "Reduced motion and animation choices",
        about: "Respecting people who are bothered by moving pictures.",
        status: "inPlace",
        detail: "You can choose how animations behave in the Hub, and light and dark themes are available. The choice is saved on each device for now.",
        evidence: "lib/animations.ts, ThemeSwitcher, docs/TODO.md",
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
          "Sign-in is by invitation. The database enforces who can read each row, staff access is limited by role, and admin pages check it again on every request. Connections are encrypted, and the Slack connection of each member is stored encrypted and used only by the Hub's server.",
        evidence: "docs/RLS_SECURITY.md, lib/supabase/middleware.ts, app/privacy/page.tsx",
      },
      {
        name: "Browser protections (Content-Security-Policy)",
        about: "A header that tells browsers which sources a page may load from.",
        status: "working",
        detail: "We send it on every page in report-only mode: it reports what it would block and blocks nothing yet.",
        evidence: "next.config.ts, lib/csp.ts",
      },
      {
        name: "Error monitoring and privacy",
        about: "Finding bugs without collecting more than needed.",
        status: "inPlace",
        detail:
          "Error recordings mask text and form fields, our monitoring provider scrubs sensitive data on its servers and does not store IP addresses, and its data is held in the EU. These settings are kept in the repository so a change is reviewed.",
        evidence: "sentry-config.yml, docs/SENTRY_CONFIG.md, instrumentation-client.ts",
      },
      {
        name: "SOC 2 and ISO 27001",
        about: "Independent audits of an organization's security practices.",
        status: "notApplicable",
        detail:
          "Quill & Cup does not hold either certificate. Our hosting and database providers publish their own audit reports, which cover the infrastructure the Hub runs on.",
        evidence: "none held; provider reports are the providers' own",
      },
    ],
  },
];

/** The services we lean on for part of the above, and what each does for us. Full list: the Privacy page. */
export interface ComplianceProvider {
  name: string;
  role: string;
  /** What they handle for compliance. */
  covers: string;
}

export const COMPLIANCE_PROVIDERS: readonly ComplianceProvider[] = [
  { name: "Stripe", role: "Payments", covers: "Card and bank details, and the PCI certification." },
  { name: "Supabase", role: "Database and sign-in", covers: "Storage in the United States, under standard contractual clauses." },
  { name: "Vercel", role: "Hosting", covers: "Hosting in the United States; counts visits and page speed in aggregate, with no individual profile." },
  { name: "Sentry", role: "Error monitoring", covers: "Errors and masked recordings, kept in the EU." },
  { name: "Mux", role: "Course video", covers: "Video hosting and, only if usage statistics are on, playback quality measured without a name, email or account id and with no cookie." },
  { name: "Slack, Zoom, Google, Kajabi and our email provider", role: "Chat, live sessions, calendar, courses and email", covers: "Each is described on the Privacy page; each is listed there as a service we use." },
];
