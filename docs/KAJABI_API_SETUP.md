# Kajabi API Integration Setup

## Check if You Have API Access

1. **Login to Kajabi Admin**
2. **Go to Settings → Integrations → API**
   - If you see "API Keys" section → You have API access! ✅
   - If you don't see this → API not available on your plan ❌

## Option 1: Kajabi API (Recommended if available)

### API Endpoints We Need

**Contacts (Members):**
```
GET https://api.kajabi.com/api/v1/contacts
```
Returns all contact data including:
- ID (contact ID for Kajabi links)
- Email, Name
- Tags, Products
- Custom fields

**Subscriptions:**
```
GET https://api.kajabi.com/api/v1/subscriptions
```
Returns subscription data including:
- Customer ID (contact ID)
- Status (Active, Paused, Canceled)
- Provider (Stripe)
- Provider ID (Stripe customer ID)

### Setup Steps

1. **Create API Key** in Kajabi Settings → Integrations → API
2. **Add to environment variables:**
   ```env
   KAJABI_API_KEY=your_api_key_here
   ```
   - For local development: Add to `.env.local`
   - For production: Add to Vercel environment variables
3. **Use the import form:** Go to `/data/import` and use the "Kajabi API Import" section
4. **Optional:** Schedule daily cron job to auto-sync (future enhancement)

### Benefits
- ✅ No manual CSV exports
- ✅ Real-time data
- ✅ Webhooks for instant updates
- ✅ Gets ALL data in one call (contacts + subscriptions)
- ✅ Includes external IDs automatically

## Option 2: Bulk CSV Export (Manual but easier than page-by-page)

### In Kajabi Admin

**Export All Contacts:**
1. Go to **Contacts**
2. Click **Export** (top right)
3. Select **All contacts** (not just current page)
4. Download CSV

**Export All Subscriptions:**
1. Go to **Sales → Subscriptions**
2. Click **Export** (top right)
3. Select **All subscriptions**
4. Download CSV

**Then:** Import both CSVs to our app via `/data/import`

## Option 3: Zapier/Make Automation (If no API)

### Using Zapier

**Zap 1: Daily Contact Export**
- Trigger: Schedule (Daily at 1 AM)
- Action: Kajabi → Get All Contacts
- Action: Google Sheets → Update spreadsheet
- Action: Webhook → POST to our `/api/import/members`

**Zap 2: Daily Subscription Export**
- Similar setup for subscriptions

### Using Make (Integromat)
- Same concept, often cheaper than Zapier
- More flexible for complex scenarios

## Recommendation

**Priority order:**
1. **Kajabi API** (if available on your plan) - Best option
2. **Bulk CSV Export** - Manual but complete
3. **Zapier/Make** - Automated but requires subscription

Check your Kajabi plan and let me know what's available!
