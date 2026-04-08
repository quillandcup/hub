# Zapier/Make Integration Analysis for Kajabi

## What Data Can We Get?

### Kajabi Zapier Integration

**Available Triggers:**
1. **New Contact** - Fires when a contact is created
2. **Updated Contact** - Fires when a contact is updated
3. **New Subscription** - Fires when someone subscribes
4. **Canceled Subscription** - Fires when subscription ends
5. **Tag Added** - Fires when tag is added to contact

**Available Actions:**
1. **Find Contact** - Search for a contact by email
2. **Create/Update Contact** - Add or modify contacts
3. **Add Tag** - Add tags to contacts
4. **Grant Access** - Give product access

### Data Fields Available

**From "Find Contact" action (most comprehensive):**
```json
{
  "id": "2270625971",  // ✅ Kajabi contact ID
  "email": "member42@example.com",  // ✅
  "name": "Member 24",  // ✅
  "first_name": "A.J.",
  "last_name": "Volante",
  "created_at": "2022-07-24T17:53:09-06:00",  // ✅
  "tags": ["Quill & Cup Member", "Offboarding"],  // ✅
  // Custom fields...
}
```

**From "New Subscription" trigger:**
```json
{
  "id": "2181268084",
  "contact_id": "2270625971",  // ✅ Links to contact
  "offer_id": "2148293442",
  "status": "active",  // ✅
  "stripe_customer_id": "cus_xxxxx",  // ⚠️ MAYBE (depends on Zapier integration)
  "created_at": "2022-09-12",  // ✅
  "next_billing_date": "2026-04-12"
}
```

## ⚠️ Critical Limitations

### 1. **Products/Offers Not in Contact Data**
**Problem:** The "Find Contact" action might not return the full `Products` field we see in CSV exports.

**CSV has:**
```
Products: "Quill & Cup Membership, BFF Program, Self Editing Academy"
```

**Zapier might only give:**
- Individual subscription records (need to query separately)
- Or may not expose products at all

### 2. **Stripe Customer ID Availability**
**Uncertain:** Whether Zapier exposes `stripe_customer_id` in subscription data.
- Kajabi stores it internally (we see it in Subscription CSV)
- But Zapier integration might not expose it
- Would need to test to confirm

### 3. **Historical Data**
**Problem:** Zapier triggers only fire on NEW/UPDATED items.
- Can't bulk export existing contacts
- Would need to:
  1. Use "Find Contact" action for each member (slow, expensive)
  2. Or wait for updates to capture data over time

### 4. **Rate Limits**
- Zapier has task limits per plan
- Each contact lookup = 1 task
- For 300 members = 300 tasks
- Free plan: 100 tasks/month ❌
- Starter ($20/mo): 750 tasks/month ❌
- Professional ($50/mo): 2000 tasks/month ✅

## Practical Zapier Workflow

### Scenario 1: Incremental Updates Only
**Best for:** Keeping data fresh after initial manual import

```
Trigger: New Contact OR Updated Contact
Action 1: Find Contact (get full details)
Action 2: HTTP Request → POST to our /api/import/members
```

**Pros:**
- Keeps data current
- Low task usage (only on changes)

**Cons:**
- Still need manual CSV for initial bulk import
- Won't get Stripe customer IDs automatically

### Scenario 2: Weekly Bulk Export via Google Sheets
**Best for:** Full automation without scraping

```
Zap 1 (Weekly):
Trigger: Schedule (Every Monday 1 AM)
Action 1: Google Sheets → Get all rows from "Kajabi Contacts" sheet
Action 2: HTTP Request → POST CSV to our /api/import/members

Zap 2 (Real-time):
Trigger: Row added to Google Sheets "Kajabi Contacts"
Action: HTTP Request → POST to our /api/import/members
```

**How it works:**
1. **Manual setup:** Export Kajabi → Import to Google Sheets (once)
2. **Zapier Zap:** Kajabi New/Updated Contact → Add/Update Google Sheets row
3. **Weekly Zap:** Google Sheets → Our app (full sync)

**Pros:**
- Google Sheets becomes "source of truth"
- Can manually add Stripe IDs to sheet
- Full automation after initial setup
- Visual data verification

**Cons:**
- Still requires initial manual export
- Google Sheets adds complexity
- Need 2 Zaps (more tasks)

## Make (Integromat) Alternative

**Advantages over Zapier:**
- Cheaper ($9/mo vs $20/mo)
- More operations included
- Better API capabilities
- Can do HTTP requests in free tier

**Same limitations:**
- Same Kajabi integration (likely)
- Same data availability issues

## Recommendation

### ✅ Best Solution: Playwright Scraper
**Reasons:**
1. **Gets ALL data** including Stripe customer IDs
2. **Uses official exports** (reliable format)
3. **Free** (GitHub Actions)
4. **Complete control**
5. **Same CSV format** we already support

### ⚠️ Acceptable Workaround: Zapier for Updates Only
**If you want to avoid scraping:**
1. **Initial:** Manual bulk CSV export (Contacts + Subscriptions)
2. **Ongoing:** Zapier to catch new/updated contacts
3. **Quarterly:** Manual re-export to catch Stripe ID changes

**Cost:** $20/mo Zapier Starter plan

### ❌ Not Recommended: Zapier for Bulk Export
**Reasons:**
- Can't get Stripe customer IDs reliably
- Expensive task usage
- Complex Google Sheets workaround
- Still needs manual initial import

## Testing Plan

Want to verify Zapier/Make before deciding? Test with free accounts:

1. **Sign up for Zapier free tier**
2. **Create test Zap:**
   - Trigger: "Find Contact" in Kajabi
   - Test with your email
3. **Check output:**
   - Does it include `id`? (Kajabi contact ID)
   - Does it include `tags`?
   - Does it include `products`?
4. **Create second test Zap:**
   - Trigger: "New Subscription"
   - Test with a subscription
5. **Check output:**
   - Does it include `stripe_customer_id`?

This will tell us exactly what data is available!

## My Recommendation

**For your use case (300 members, daily updates):**

**Phase 1 (Now):** 
- Continue manual CSV exports using "Export All" (not page-by-page)
- Import Contacts + Subscriptions CSVs weekly

**Phase 2 (Next month):**
- Build Playwright scraper for full automation
- Run daily via GitHub Actions
- Email alerts on failures
- Cost: $0

**Alternative if Playwright fails:**
- Zapier for incremental updates only
- Manual quarterly bulk re-exports
- Cost: $20/mo

Want me to build the Playwright scraper or test Zapier first?
