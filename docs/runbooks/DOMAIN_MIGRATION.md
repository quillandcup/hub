# Moving quillandcup.com from Kajabi to the Hub

> **Status:** living. **Last reviewed:** 2026-11-22. Review: yearly. Kept up to date with the code; if it is wrong, fix it. Delete it once Kajabi is retired and the "End state" section is done.

Step-by-step checklist for moving quillandcup.com from Kajabi to the Hub while courses stay on a Kajabi subdomain. A checklist to follow by hand. Target: **Dec 3 to 5, 2026** (the retreat is Dec 12, so there is a week of buffer). Where this says "verify in your dashboard", nobody has checked that screen while writing this page, so trust what the screen says over this page.

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->

- [The plan in one picture](#the-plan-in-one-picture)
- [Why DNS has to move first](#why-dns-has-to-move-first)
- [Part 1. Prep (Nov 21 to Nov 30)](#part-1-prep-nov-21-to-nov-30)
  - [1.1 Save the "before" picture](#11-save-the-before-picture)
  - [1.2 Decide and prepare](#12-decide-and-prepare)
  - [1.3 Member heads-up (draft)](#13-member-heads-up-draft)
- [Part 2. Email safety](#part-2-email-safety)
- [Part 3. Move DNS to Squarespace (as early as you like, ideally the week of Nov 24; invisible to members)](#part-3-move-dns-to-squarespace-as-early-as-you-like-ideally-the-week-of-nov-24-invisible-to-members)
- [Part 4. Code (before the cutover)](#part-4-code-before-the-cutover)
- [Part 5. The cutover (Dec 3 or 4, early morning Eastern)](#part-5-the-cutover-dec-3-or-4-early-morning-eastern)
- [Part 6. Sign-in, cookies, payments](#part-6-sign-in-cookies-payments)
- [Part 7. Verify right after the cutover](#part-7-verify-right-after-the-cutover)
- [Part 8. Rollback and the alternative](#part-8-rollback-and-the-alternative)
- [Part 9. After launch (first weeks)](#part-9-after-launch-first-weeks)
- [End state: retiring Kajabi pages one at a time](#end-state-retiring-kajabi-pages-one-at-a-time)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

## The plan in one picture

| Address | Today | After |
|---|---|---|
| `quillandcup.com` (the root) | Kajabi | The Hub: homepage, public writer profiles, landing pages. Every other path redirects (temporary, 307) to the same path on `courses.quillandcup.com`. |
| `www.quillandcup.com` | Kajabi | Redirects (307) to the root. |
| `courses.quillandcup.com` | not used | Kajabi: courses, checkout, its own member login. |
| `hub.quillandcup.com` | the Hub | The Hub, unchanged: the signed-in app, Slack, calendar, auth emails. |

`/login` on the root goes to `hub.quillandcup.com/login`, which has a "Still on Kajabi? Sign in there" link (members on hiatus can only use Kajabi, for billing).

The code is two pull requests (see "Code" below). They are drafts on purpose, so they can't merge on their own before you are ready.

## Why DNS has to move first

The name servers for `quillandcup.com` are **Kajabi's** (`jermaine.ns.cloudflare.com` and `joyce.ns.cloudflare.com`, seen in the Squarespace "custom nameservers" notice). The records you see in Squarespace's DNS page are not active; the live ones are on Kajabi's "DNS Settings" page, which only offers "Custom Record". Kajabi's help article ("Connect a custom domain") confirms it: a root domain can only be connected to Kajabi through Kajabi's name servers, Kajabi redirects the bare root to `www`, and a **subdomain** (like `courses`) can be connected with a plain CNAME record at any DNS host. So DNS moves to **Squarespace's own name servers** first, days before the cutover, with the same records, so that nothing changes for visitors. Only then do the cutover steps become a few record edits in a place you control.

What the Kajabi article does **not** say, and you should verify early (Part 3 does): whether Kajabi keeps serving `www.quillandcup.com` once its name servers are no longer in use. Moving the name servers early gives you time to find out. The same article warns: "Each Kajabi site can have only one custom domain connected at a time", so switching Kajabi to `courses` means removing `www` first (Part 5).

---

## Part 1. Prep (Nov 21 to Nov 30)

### 1.1 Save the "before" picture
Do all of these; they are your rollback.
1. Kajabi → Settings → Domain Settings → DNS Settings (`app.kajabi.com/admin/sites/<id>/custom_domain/dns_settings`). Print or save the whole page as a PDF (done once on 2026-11-22; the records are in the table below). Do it again right before Part 3 in case something changed.
2. Kajabi → Domain Settings (the page above DNS Settings): screenshot what it says about the custom domain and what records Kajabi asks for.
3. Squarespace → Domains → quillandcup.com → DNS Settings: screenshot, including Email Forwarding → Manage rules (the list of forwarding addresses, and where each goes).
4. In a terminal, save today's public answers (copy the output into a note outside the repo):
   ```
   dig quillandcup.com A
   dig quillandcup.com AAAA
   dig www.quillandcup.com A
   dig quillandcup.com MX
   dig quillandcup.com TXT
   dig _dmarc.quillandcup.com TXT
   dig quillandcup.com NS
   ```
5. The records in **Kajabi's DNS Settings as of 2026-11-22** (the whole page; every one must exist, with the same value, in Squarespace before the name servers move). Copy long values (keys, DKIM targets) from Kajabi's page or the saved PDF, never retype them. Names below are relative to `quillandcup.com`.

| Name | Type | Value | What it is for |
|---|---|---|---|
| `@` (the bare root) | CNAME | `endpoint.mykajabi.com` | Kajabi's site. Kajabi's DNS flattens it, which is why `dig` shows Cloudflare addresses. Squarespace cannot hold a CNAME on the bare root; see Part 3. **Changes at cutover.** |
| `www` | CNAME | `endpoint.mykajabi.com` | Kajabi's site today. **Changes at cutover.** |
| `@` | MX | `10 mxa.mailgun.org`, `10 mxb.mailgun.org` | Squarespace email forwarding (mail to `@quillandcup.com`). **Never change.** |
| `@` | TXT | `v=spf1 include:mailgun.org ~all` | SPF for the above. **Never change.** |
| `@` | TXT (2 records) | `stripe-verification=…` | Stripe domain verification. Copy exactly. |
| `_dmarc` | TXT | `v=DMARC1; p=none; rua=mailto:dmarc_kjb@kajabi.com,mailto:dmarc_agg@vali.email; fo=1; pct=100; rf=afrf;` | Reports only (`p=none`), nothing is blocked. |
| `k1._domainkey` | TXT | `k=rsa; p=…` (long key; copy from Kajabi) | DKIM, Kajabi's mail. |
| `k2._domainkey`, `k3._domainkey` | CNAME | `dkim2.mcsv.net`, `dkim3.mcsv.net` | DKIM, Mailchimp (Ania's newsletter). |
| `kjbm` | MX | `10 mxa.mailgun.org`, `20 mxb.mailgun.org` | Kajabi's sending subdomain. |
| `kjbm` | TXT | `v=spf1 include:mailgun.org ~all` | SPF for it. |
| `_dmarc.kjbm` | TXT | `v=DMARC1; p=none; …` (the Mailgun/ondmarc one; copy from Kajabi) | DMARC reports for it. |
| `smtp._domainkey.kjbm` | TXT | `k=rsa; p=…` (copy from Kajabi) | DKIM for Kajabi's mail. |
| `email.kjbm` | CNAME | `mailgun.org` | Kajabi's sending. |
| `bounce` | CNAME | `custom-email-domain.stripe.com` | Stripe sends email as quillandcup.com. |
| Six Stripe DKIM names: `cv5ejcs6du7ah6wj25qo3q5iufv3mlyk._domainkey`, `fp5ycxdzqdq56iqa7sibp3rb3jyriboy._domainkey`, `hv646m4ogwuosoyoszuhfbesuxy6oi26._domainkey`, `ji63dnlxilnqouh67h3kiq4aidgwvwyy._domainkey`, `jiqqxxufiv7s6sbgm5uhaumoifl63hvy._domainkey`, `tsgai3nwxez4ete37d573sqaq5s6zgtg._domainkey` | CNAME | each to `<same first part>.dkim.custom-email-domain.stripe.com` | Stripe's DKIM (the names above came from reading the PDF; check each against Kajabi's page). |
| `hub` | CNAME | `7abcdafdd394d748.vercel-dns-017.com` | The Hub. |
| `bounce.hub` | CNAME | `send.forge.rmta.net` | The Hub's Resend sending (verify in Resend). |
| `rbounce.hub` | CNAME | `rsend.forge.rmta.net` | The same. |
| `resend._domainkey.hub` | TXT | `p=…` (long key; copy from Kajabi) | DKIM for the Hub's email through Resend. |

6. Check this table against Kajabi's page line by line (the page's A Record and SRV Record sections are empty). Also check Resend (Domains) and Mailchimp (Domains) for any record they list that is not in the table.

### 1.2 Decide and prepare
- Pick a **quiet time** for the cutover: early morning Eastern, mid-week (Dec 3 or 4), not a billing day. Check Kajabi → Sales for when subscriptions renew in bulk.
- The **top pages** come from Google Analytics (Kajabi's own numbers are inflated), 30 days to 2026-11-22: `/login`, `/library`, `/` , `/products/quill-cup-membership`, `/products/the-ready-writer`, `/waitlist`, `/hedgie-books`, `/blog`, `/products/the-ready-writer/categories/<id>`, `/about`, plus `/free-trial` (the Join link). They are in `scripts/data/redirect-check-urls.txt` with the expected outcome (`kajabi`, except `/` and `/login`). Kajabi → Website → Pages lists 16 website pages (some are System pages) and Kajabi → Pages → Landing lists the landing pages: write down each page's address and add any that is not in the list, since Analytics only shows pages someone visited. Add anything from Google Search Console → Performance → Pages, your Instagram bio, and the links in your welcome and automation emails. Only about 1,300 page views a month are tracked, so a handful of real visitors is a big share: check each of these by hand too (Part 7).
- Draft the **member heads-up** (below). Send it 2 days before.
- Check whether your Vercel account can add the root domain (you must be an owner or member of the project's team).

### 1.3 Member heads-up (draft)
> **Subject:** A short sign-in change on quillandcup.com
>
> On [date] we're moving the Quill & Cup website to its new home. Your courses and billing stay in Kajabi, now at courses.quillandcup.com. You'll be signed out of Kajabi once, so you'll sign in again with the same email. Every old link keeps working. If anything looks wrong, write to support@quillandcup.com.

---

## Part 2. Email safety

Email is where a DNS move hurts silently. The rules:
- **Never change or remove** the root MX and SPF records (Squarespace forwarding) or any DKIM, DMARC, Stripe or Resend record in the table above.
- The root SPF is `v=spf1 include:mailgun.org ~all`. It has one `include`, well under the 10-lookup limit. Don't add to it. Kajabi, Stripe, Resend and Mailchimp each send through their own subdomain or DKIM key, not through this SPF line, and DMARC is `p=none`.
- **Don't create a second MX/SPF.** Squarespace adds the forwarding records itself once its name servers are used (it shows them under "Squarespace Email Forwarding", read-only). Check the page after the switch; if they are listed there, do not add them by hand.
- There is no CAA record today, so any certificate authority may issue; Vercel's and Kajabi's will work. If you ever add one, it must allow `letsencrypt.org` (Vercel) and whatever Kajabi tells you.
- **DNSSEC** is off today (no DS record), so there is nothing to carry over.

After the name-server switch (Part 3) and after the cutover (Part 5), send a test from each sender and open "Show original" in Gmail; look for `SPF: PASS`, `DKIM: PASS` and `DMARC: PASS` (or `p=none` with a pass on either SPF or DKIM):
1. Kajabi: send yourself an email from a Kajabi automation or broadcast.
2. Mailchimp: Ania sends a test of the newsletter to you.
3. Squarespace forwarding: from another account, write to a forwarding address and confirm it arrives.
4. Stripe: Dashboard → Settings → Emails → send a test receipt (verify in your dashboard).
5. The Hub: request a sign-in link on `hub.quillandcup.com/login` for a staff address.

---

## Part 3. Move DNS to Squarespace (as early as you like, ideally the week of Nov 24; invisible to members)

The goal: the same records, answered from Squarespace instead of Kajabi. Do this **well before the cutover** (at least 2 days; earlier is better), because a name-server change can take up to 48 hours to reach everyone, and because this is the step that might surprise us (see "Why DNS has to move first"). Pick a quiet early morning; traffic is small, so a problem is cheap if you catch it early.

1. Squarespace → Domains → quillandcup.com → **DNS Settings**. You see "You're using custom nameservers" and the forwarding records. Do **not** switch name servers yet.
2. Add every record from the table in 1.1 except the `@` MX and `@` SPF (those come with email forwarding). If Squarespace's screen lets you set a TTL, use the lowest (5 minutes); verify in the screen, the default shown is 4 hours.
   - **`www`**: add a CNAME to `endpoint.mykajabi.com`, exactly as Kajabi has it. Kajabi's article documents a CNAME as the way to connect a `www` or other subdomain from an outside DNS host, so the site should keep working.
   - **The bare root `@`**: Kajabi has a CNAME there, which Squarespace (like most DNS hosts) cannot hold on the bare root, and Kajabi's article says the bare root only ever redirected to `www`. Two choices; **I recommend the first**:
     1. Add the **Vercel records for the root now** (get them from Vercel → the Hub project → Settings → Domains → add `quillandcup.com`; see Part 5, step 1). Until the cutover, someone typing the bare `quillandcup.com` sees the Hub's sign-in page instead of being sent to the Kajabi site. Few people do (almost all Kajabi traffic is on `www`), and Part 5 fixes it.
     2. Leave the bare root without a record until the cutover. The bare root then does not load at all in the meantime.
   - **If, after the switch (step 5), Kajabi shows the domain as disconnected or `www` stops loading**, read Kajabi's message and fix it there; the documented fallback is to remove the domain in Kajabi and reconnect `www` with the CNAME method (Kajabi → Settings → Site settings → Domain → Set up custom domain → Create subdomain for Kajabi site). If `www` is down and you can't fix it in minutes, use the undo below.
3. **Check Squarespace's answers before switching.** For each record in the table, ask Squarespace's name servers directly and compare to the "before" answers (find their names under Domain Nameservers → verify in your dashboard):
   ```
   dig @<squarespace-nameserver> quillandcup.com A
   dig @<squarespace-nameserver> quillandcup.com MX
   dig @<squarespace-nameserver> quillandcup.com TXT
   ```
   (repeat for each name in the table).
4. Squarespace → Domain Nameservers → switch to the Squarespace nameservers (verify the wording in your dashboard; this is the step that is hard to undo quickly).
5. Check over the next hours: `dig quillandcup.com NS` shows Squarespace's. Open `https://www.quillandcup.com`, log in to Kajabi, load a course, and do the email tests in Part 2.
6. **Do not edit or delete anything in Kajabi's DNS Settings.** It stays as it was, as your rollback.

**Undo (Part 3):** set the name servers back to `jermaine.ns.cloudflare.com` and `joyce.ns.cloudflare.com` in Squarespace. Kajabi's records are untouched, so the site and email carry on; the change takes up to 48 hours to spread.

Note: once Kajabi's name servers are no longer used, a record Kajabi adds later (for example a new email-sending record) will not appear on its own. If Kajabi shows a warning about the domain, read what it asks for and add that record in Squarespace.

---

## Part 4. Code (before the cutover)

Two draft pull requests; read each description before merging.
- **PR #1648**: the redirect fallback, the root homepage, the config map for explicit redirects, the "Still on Kajabi?" link, and `pnpm check:redirects`. Base: `main`.
- **PR #1651**: public pages (writer profiles, landing pages) get the root as their address, and the same pages on `hub.quillandcup.com` redirect to it. Base: PR #1648 (change the base to `main` after #1648 merges).

Both are inactive on the root domain until DNS points at Vercel. Merging **PR #1648 shortly before the cutover** (the morning of) is the plan. Between that merge and the DNS change, the "Join the waitlist" link in the Hub's Courses page points at `courses.quillandcup.com`, which does not work until Part 5, step 6; that window should be under an hour.

`joinUrl` is `https://quillandcup.com/free-trial` for now (it lands on Kajabi's free-trial page through the redirect); change it in `config/app.ts` when the Join page moves. The root homepage is the published landing page with the slug `home`, built in the Hub at `/admin/pages/home`; if no published `home` page exists the root shows a plain fallback, so publish `home` before the cutover. Merge #1648 when the checks are green and watch the `main` run until it deploys.

---

## Part 5. The cutover (Dec 3 or 4, early morning Eastern)

Keep the gap, between Kajabi leaving the root and the Hub taking over, to a few minutes. Open these in tabs first: Squarespace DNS, Kajabi Domain Settings, Vercel → the Hub project → Settings → Domains.

1. **Vercel: add the domains** (no effect on the live site yet). Add `quillandcup.com` and `www.quillandcup.com`. Make the root the primary. For `www`, add it as a normal domain; the app itself redirects it to the root (don't also tick Vercel's own "redirect" option, so there is one redirect, not two). Vercel shows the exact records it wants and will say "Invalid Configuration" until DNS changes. **Use the values Vercel shows** (verify in your dashboard); they are usually an A record for the root and a CNAME for `www`.
2. **Squarespace DNS: check the TTLs** on `@` and `www` are the lowest value (Part 3 set them).
3. **Kajabi: remove the old domain.** Kajabi allows only one custom domain, so `www` has to go before `courses` can be added. Kajabi → Settings → Site settings → Domain → the "…" menu next to the domain → Remove. Kajabi says this "isn't instant" and can take a few minutes. **From here until step 6 the Kajabi site is down on its old address.** Have steps 4 to 6 ready.
4. **Kajabi: add the subdomain.** Same page → Set up custom domain → "Create subdomain for Kajabi site". Enter `quillandcup.com` and the subdomain `courses`, click Next. Kajabi shows the exact CNAME **Host** and **Target**; Kajabi says its screen "is the source of truth" because the target can differ per account. Don't click Done yet.
5. **Squarespace DNS: all three edits in one sitting.**
   1. Add the `courses` CNAME exactly as Kajabi showed it.
   2. Change `www` from the Kajabi CNAME to Vercel's value for `www` (shown in Vercel in step 1; usually a CNAME).
   3. Change the root `@` to Vercel's value for the root (usually an A record; if Part 3 already did it, nothing to do).
   Leave every other record alone, especially MX, SPF, DKIM, Stripe and Resend.
6. **Kajabi: back in Kajabi click Done, then "verify domain"** (the wording may differ; verify in your dashboard). Kajabi says most connections finish within 24 hours, but with the record in place it is usually minutes; its setup-error grace period for a CNAME is about 60 minutes. Load `https://courses.quillandcup.com` when it is ready. Kajabi gives the certificate (through Cloudflare); no timing is promised.
7. In Vercel → Domains, wait for both domains to turn to "Valid Configuration" and the certificate to be issued (usually a couple of minutes).
8. **Merge PR #1651** (after changing its base to `main`), and watch the `main` run until it deploys (`gh run list --branch main --limit 3`).
9. Run the checks in Part 7.

**Undo (Part 5):** in Kajabi remove `courses` and reconnect `www` by the CNAME method (Kajabi → Settings → Site settings → Domain → Set up custom domain → Create subdomain for Kajabi site, with the subdomain `www`), and in Squarespace DNS set `www` back to the CNAME `endpoint.mykajabi.com` (or the target Kajabi shows). With a 5-minute TTL it is back in about 5 to 10 minutes plus Kajabi's own verification time. If the Hub code is the problem and DNS is fine, revert the PR instead.

---

## Part 6. Sign-in, cookies, payments

**Sign-in and cookies**
- Hub sessions are cookies for `hub.quillandcup.com` only (no `Domain` attribute, `SameSite=Lax`). They stay host-only on purpose: a cookie shared across `.quillandcup.com` would also be sent to Kajabi and to the public pages, with no benefit, since the signed-in app stays on `hub`. Nobody is signed out of the Hub by this change.
- Members **are signed out of Kajabi once**: its cookies were for the old address, and Kajabi now lives on `courses.quillandcup.com`. They sign in again with the same email. That is what the heads-up says.
- Kajabi's old cookies (`_kjb_session`, `_csrf_token`, `AWSALB*`) on `www.quillandcup.com` are harmless: the browser may send them to the Hub, which ignores them, and they expire within a day to a week. Nothing to do.
- **Supabase** (Site URL, redirect list, email templates, SMTP): **no change**, since the app address does not move. Verify in the Supabase dashboard (Authentication → URL Configuration) that the Site URL is still `https://hub.quillandcup.com/auth/callback`.
- **HSTS**: `hub.quillandcup.com` sends it (2 years, no `includeSubDomains`). The root and `www` did not send it. Don't add `includeSubDomains` or `preload` for `quillandcup.com`: it would force HTTPS on `courses` before Kajabi's certificate is proven, and is hard to take back.

**Payments**
- The Hub has no Stripe checkout or webhook code yet, so nothing in the Hub needs updating. Billing is still Kajabi's.
- In Stripe → Developers → Webhooks, look for any endpoint with a `quillandcup.com` address. Kajabi's own webhooks use Kajabi's addresses, so there should be none; if there is one, tell me before changing it.
- Keep the Stripe `bounce` and DKIM records (Part 1 table).
- Do a **test purchase** on `https://courses.quillandcup.com` end to end (a low-price offer with a 100% coupon, or Kajabi's test mode if it has one; verify in the dashboard). Confirm the receipt arrives and shows the right sender.
- Subscriptions renew at Stripe/Kajabi, not through your domain. A day later, Kajabi → Sales → Transactions: confirm renewals still succeeded.

---

## Part 7. Verify right after the cutover

1. **The script** (it only reads; run it from a checkout of `main`):
   ```
   pnpm check:redirects https://quillandcup.com
   ```
   Every line should say it matches. Add your real top URLs to `scripts/data/redirect-check-urls.txt` first, with the outcome `kajabi`. Lines that mismatch are listed with the status and destination actually received.
2. **By hand**, in a private window and then on your phone (mobile data, not Wi-Fi):
   - `https://quillandcup.com` shows the Hub homepage with Join and Member login.
   - `https://www.quillandcup.com` goes to `https://quillandcup.com`.
   - Member login goes to `hub.quillandcup.com/login`; "Still on Kajabi? Sign in there" goes to the Kajabi login.
   - `https://quillandcup.com/library`, a course deep link, an offer or checkout link, a landing page and a blog post each land on the same address at `courses.quillandcup.com`, query intact (try `?utm_source=instagram&coupon=TEST`).
   - Your Instagram link-in-bio and the links inside a Kajabi automated email (send one to yourself).
   - A writer profile on the root (`https://quillandcup.com/w/<handle>`) loads; the same address on `hub.quillandcup.com` redirects to the root.
3. Email tests (Part 2).
4. Slack: type a Hub slash command and click a Hub button in Slack (they use `hub.quillandcup.com`, unchanged).

---

## Part 8. Rollback and the alternative

**If the problem is the Hub code:** revert the PR (one at a time, newest first); DNS stays.

**If `www` stops working on Kajabi after the name servers move (Part 3, step 2) and the CNAME reconnect does not fix it:** ask Kajabi support, or put the whole zone in a Cloudflare account you control with the same records; Kajabi only needs `www` and `courses` as CNAMEs, so either DNS host works. That needs a rewrite of Part 3; ask before starting it.

**If DNS is wrong after the cutover:** records come back within the TTL (5 minutes if set in Part 3; 4 hours if you left the default). The name-server change itself (Part 3) can take up to 48 hours, which is why it is done early and never on cutover day.

---

## Part 9. After launch (first weeks)

- **Search Console**: add `https://courses.quillandcup.com` as a property, and keep the root (the new `https://quillandcup.com` property if you use a URL-prefix property). Submit the root's sitemap (`https://quillandcup.com/robots.txt` lists it). Kajabi's own sitemap is on `courses`.
- **Watch what people still use**: Vercel → the project → Logs / Observability, filter the root host for 307 responses. Or from the terminal (read-only): `node_modules/.bin/vercel logs --project hub --scope <team> --environment production --since 24h --status-code 307`. The paths that show up most are the Kajabi pages to rebuild next.
- Update the Instagram bio, email templates and Kajabi's own internal links (Kajabi → Website → navigation and email footers) so they point to their new addresses directly. Fewer redirects, fewer surprises.
- **Kajabi's "system" pages stay up.** Kajabi marks some website pages as System (Home, Blog, Blog Post, and probably Login and Library) and says it "cannot change statuses of system pages", so they can't be unpublished. After the cutover `courses.quillandcup.com/` still shows Kajabi's old home page, and every "Home" link or logo in Kajabi's header, footer and automated emails still lands on it, not on the Hub's homepage. In Kajabi → Website → Navigation (and Settings → Site details / email footers; verify the menus in your dashboard) point the logo and "Home" links at `https://quillandcup.com`. Kajabi's other website pages (About, Contact, Verified Service Providers, and so on) are ordinary pages that stay reachable at the same path on `courses`; the root redirects to them until the Hub has its own.
- Change `joinUrl` and the homepage content in `config/app.ts` and `src/app` as pages are rebuilt.

## End state: retiring Kajabi pages one at a time

1. Build the Hub page at the same path (a new top-level page must be named in `src/lib/root-routing.ts`; a test fails if it is not).
2. Merge it. From then on that path is served by the Hub; every other path still redirects.
3. When a Kajabi page is gone for good, add an entry in `src/lib/root-redirects.ts` with `permanent: true` (308) pointing at its replacement. Use permanent only for these; browsers cache it and search engines move the ranking.
4. When the last page is gone and no member uses Kajabi: stop the fallback (the Kajabi branch of `decideRoute` in `src/lib/root-routing.ts`; unknown paths then 404), cancel the Kajabi plan, and remove `courses.quillandcup.com`'s DNS record and the Kajabi DKIM, `email.kjbm` and `k1` records. Keep the MX/SPF, Stripe, Resend and Mailchimp records. Remove `kajabiSiteUrl` and related config in the same PR.
