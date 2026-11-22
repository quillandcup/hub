# Moving quillandcup.com from Kajabi to the Hub

> **Status:** living. **Last reviewed:** 2026-11-21. Review: yearly. Kept up to date with the code; if it is wrong, fix it. Delete it once Kajabi is retired and the "End state" section is done.

A checklist to follow by hand. Target: **Dec 3 to 5, 2026** (the retreat is Dec 12, so there is a week of buffer). Where this says "verify in your dashboard", nobody has checked that screen while writing this page, so trust what the screen says over this page.

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

The name servers for `quillandcup.com` are **Kajabi's** (`jermaine.ns.cloudflare.com` and `joyce.ns.cloudflare.com`, seen in the Squarespace "custom nameservers" notice). The records you see in Squarespace's DNS page are not active; the live ones are on Kajabi's "DNS Settings" page, which only offers "Custom Record". Kajabi will most likely not let you point the root at Vercel from there, so DNS moves to **Squarespace's own name servers** first, as a change nobody can see, days before the cutover. Only then do the cutover steps become a few record edits in a place you control.

---

## Part 1. Prep (Nov 21 to Nov 30)

### 1.1 Save the "before" picture
Do all of these; they are your rollback.
1. Kajabi → Settings → Domain Settings → DNS Settings (`app.kajabi.com/admin/sites/<id>/custom_domain/dns_settings`). Take full-page screenshots, scrolling to the **bottom**: A Record, CNAME Record, **TXT Record, MX Record** and anything else. The earlier screenshot stopped partway.
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
5. Known records as of 2026-11-21 (these must all exist, with the same values, in the new place):

| Name | Type | Value | What it is for |
|---|---|---|---|
| `@` | A | `104.21.7.87`, `172.67.135.234` | Kajabi's site (root). **Changes at cutover.** |
| `@` | AAAA | `2606:4700:3032::ac43:87ea`, `2606:4700:3032::6815:757` | Kajabi's site (root). **Changes at cutover.** |
| `www` | A / AAAA | the same Kajabi addresses | Kajabi's site. **Changes at cutover.** |
| `@` | MX | `10 mxa.mailgun.org`, `10 mxb.mailgun.org` | Squarespace email forwarding (mail to `@quillandcup.com`). **Never change.** |
| `@` | TXT | `v=spf1 include:mailgun.org ~all` | SPF for the above. **Never change.** |
| `@` | TXT (2 records) | `stripe-verification=…` | Stripe domain verification. Copy exactly. |
| `_dmarc` | TXT | `v=DMARC1; p=none; rua=mailto:dmarc_kjb@kajabi.com,mailto:dmarc_agg@vali.email; fo=1; pct=100; rf=afrf;` | Reports only (`p=none`), nothing is blocked. |
| `k1._domainkey` | TXT | (long key; copy from the Kajabi page) | DKIM, Kajabi's mail. |
| `k2._domainkey`, `k3._domainkey` | CNAME | `dkim2.mcsv.net`, `dkim3.mcsv.net` | DKIM, Mailchimp (Ania's newsletter). |
| `email.kjbm` | CNAME | `mailgun.org` | Kajabi's sending subdomain. |
| `bounce` | CNAME | `custom-email-domain.stripe.com` | Stripe sends email as quillandcup.com. |
| `cv5ejcs6du7ah6wj25qo3q5iufv3mlyk._domainkey` | CNAME | `cv5ejcs6du7ah6wj25qo3q5iufv3mlyk.dkim.custom-email-domain.stripe.com` | Stripe's DKIM. |
| `hub` | CNAME | the `….vercel-dns-017.com` value shown today | The Hub. |
| `bounce.hub` | CNAME | `send.forge.rmta.net` | Looks like the Hub's Resend sending (verify in Resend). |
| `resend._domainkey.hub` | TXT | (long key; copy from the Kajabi page) | DKIM for the Hub's email through Resend. |

6. **The list above is only what I could see.** Anything else on Kajabi's page (especially in the part not yet screenshotted) must be added to this table before you go on. Also check Resend (Domains) and Mailchimp (Domains) for any record they list that is not in the table.

### 1.2 Decide and prepare
- Pick a **quiet time** for the cutover: early morning Eastern, mid-week (Dec 3 or 4), not a billing day. Check Kajabi → Sales for when subscriptions renew in bulk.
- Pull the **top 20 to 30 URLs** people actually use: Kajabi → Analytics (top pages), Google Search Console → Performance → Pages, and your Instagram bio, welcome emails and automation emails. Put them in `scripts/data/redirect-check-urls.txt` (see "Verifying", below) with the outcome `kajabi`.
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

## Part 3. Move DNS to Squarespace (Nov 28 to Dec 1; invisible to members)

The goal: the same records, answered from Squarespace instead of Kajabi. Do this **at least 2 days before the cutover**, because a name-server change can take up to 48 hours to reach everyone.

1. Squarespace → Domains → quillandcup.com → **DNS Settings**. You see "You're using custom nameservers" and the forwarding records. Do **not** switch name servers yet.
2. Add every record from the table in 1.1 that is not an `@` MX/SPF (those come with email forwarding). Add the **Kajabi-side `@` and `www` records unchanged** (Kajabi's current values), so the site keeps working. If Squarespace's screen lets you set a TTL, use the lowest (5 minutes); verify in the screen, the default shown is 4 hours.
   - **Ask Kajabi first**: Kajabi → Domain Settings may tell you what records an outside DNS host needs for the root and `www` (the page was not seen while writing this). If Kajabi says its custom domain only works on its own name servers, stop here and use Part 8 (alternative) instead.
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

Both are inactive on the root domain until DNS points at Vercel. Merging **PR #1648 shortly before the cutover** (the morning of) is the plan. Between that merge and the DNS change, the "Join the waitlist" link in the Hub's Courses page points at `courses.quillandcup.com`, which does not work until step 5.4; that window should be under an hour.

Before the cutover, edit `config/app.ts` if needed (a small PR, same rules): `joinUrl` (the real Join page on Kajabi; it defaults to the Kajabi home), and the homepage wording. Then merge #1648 when the checks are green and watch the `main` run until it deploys.

---

## Part 5. The cutover (Dec 3 or 4, early morning Eastern)

Keep the gap, between Kajabi leaving the root and the Hub taking over, to a few minutes. Open these in tabs first: Squarespace DNS, Kajabi Domain Settings, Vercel → the Hub project → Settings → Domains.

1. **Vercel: add the domains** (no effect on the live site yet). Add `quillandcup.com` and `www.quillandcup.com`. Make the root the primary. For `www`, add it as a normal domain; the app itself redirects it to the root (don't also tick Vercel's own "redirect" option, so there is one redirect, not two). Vercel shows the exact records it wants and will say "Invalid Configuration" until DNS changes. **Use the values Vercel shows** (verify in your dashboard); they are usually an A record for the root and a CNAME for `www`.
2. **Squarespace DNS: lower any leftover TTL** on `@` and `www` to the lowest value, and wait for the old TTL to pass if it was higher (this is why Part 3 set it early).
3. **Squarespace DNS: add the `courses` record** that Kajabi asks for (CNAME to Kajabi's target; get the exact value in Kajabi → Domain Settings when you choose the new domain; verify there).
4. **Kajabi: change the custom domain** from `www.quillandcup.com` to `courses.quillandcup.com` (Kajabi → Settings → Domain Settings; verify in your dashboard). Wait until Kajabi says the domain is connected and the certificate is issued (it may take from minutes to a few hours). Load `https://courses.quillandcup.com`.
   From here until step 5 the root address does not work. Do the next step straight away.
5. **Squarespace DNS: point the root at Vercel.** Edit the `@` A/AAAA records and the `www` records to the values Vercel showed in step 1 (delete the old Kajabi addresses on those two names only; leave every other record alone, especially MX, SPF, DKIM, Stripe and Resend).
6. In Vercel → Domains, wait for both domains to turn to "Valid Configuration" and the certificate to be issued (usually a couple of minutes).
7. **Merge PR #1651** (after changing its base to `main`), and watch the `main` run until it deploys (`gh run list --branch main --limit 3`).
8. Run the checks in Part 7.

**Undo (Part 5):** in Squarespace DNS put the `@` and `www` records back to the Kajabi values from the "before" snapshot, and in Kajabi change the custom domain back to `www.quillandcup.com`. With a 5-minute TTL the root is back within about 5 to 10 minutes plus Kajabi's own certificate time. If the Hub code is the problem and DNS is fine, revert the PR instead.

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

**If Kajabi's custom domain will not work on Squarespace's name servers (Part 3, step 2):** the options are (a) ask Kajabi support whether they can host the root pointing at an external site, which they probably cannot, or (b) put the whole zone in a Cloudflare account you control, with the same records. That needs a rewrite of Part 3; ask before starting it.

**If DNS is wrong after the cutover:** records come back within the TTL (5 minutes if set in Part 3; 4 hours if you left the default). The name-server change itself (Part 3) can take up to 48 hours, which is why it is done early and never on cutover day.

---

## Part 9. After launch (first weeks)

- **Search Console**: add `https://courses.quillandcup.com` as a property, and keep the root (the new `https://quillandcup.com` property if you use a URL-prefix property). Submit the root's sitemap (`https://quillandcup.com/robots.txt` lists it). Kajabi's own sitemap is on `courses`.
- **Watch what people still use**: Vercel → the project → Logs / Observability, filter the root host for 307 responses. Or from the terminal (read-only): `node_modules/.bin/vercel logs --project hub --scope <team> --environment production --since 24h --status-code 307`. The paths that show up most are the Kajabi pages to rebuild next.
- Update the Instagram bio, email templates and Kajabi's own internal links (Kajabi → Website → navigation and email footers) so they point to their new addresses directly. Fewer redirects, fewer surprises.
- Change `joinUrl` and the homepage content in `config/app.ts` and `src/app` as pages are rebuilt.

## End state: retiring Kajabi pages one at a time

1. Build the Hub page at the same path (a new top-level page must be named in `src/lib/root-routing.ts`; a test fails if it is not).
2. Merge it. From then on that path is served by the Hub; every other path still redirects.
3. When a Kajabi page is gone for good, add an entry in `src/lib/root-redirects.ts` with `permanent: true` (308) pointing at its replacement. Use permanent only for these; browsers cache it and search engines move the ranking.
4. When the last page is gone and no member uses Kajabi: stop the fallback (the Kajabi branch of `decideRoute` in `src/lib/root-routing.ts`; unknown paths then 404), cancel the Kajabi plan, and remove `courses.quillandcup.com`'s DNS record and the Kajabi DKIM, `email.kjbm` and `k1` records. Keep the MX/SPF, Stripe, Resend and Mailchimp records. Remove `kajabiSiteUrl` and related config in the same PR.
