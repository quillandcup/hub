# TODO / Future Enhancements

## Member Status Refinements

### Fix Hiatus Tracking - TRUST ISSUE
**Problem:** Hiatus detection doesn't match manual spreadsheet. At-risk members may include people on known hiatus.

**Current Status Detection Logic:**
- Active: has "Quill & Cup Membership" product
- On Hiatus: has "Quill & Cup Member" tag but no product AND no "Offboarding" tag
- Inactive: has "Offboarding" tag OR neither product nor member tag

**Root Cause:** Missing or inconsistent source data from Kajabi
- Offboarding tags not consistently applied in Kajabi
- Manual hiatus spreadsheet may be more accurate than Kajabi tags
- ~21 members identified as needing Offboarding tag (hiatus ended, didn't resubscribe)

**Action Required:**
1. Audit Kajabi tagging - ensure SOPs are followed
2. Compare Kajabi export vs manual hiatus spreadsheet
3. Determine source of truth (Kajabi or spreadsheet?)
4. Either: Fix Kajabi tags OR import hiatus data from spreadsheet
5. Re-import and verify on_hiatus count matches expectations

### Enhanced Inactive Member Classification
Currently all inactive members are grouped together. Add granular status to distinguish:
- **Former Member** - Had "Quill & Cup Membership" product in the past but cancelled
- **Former Trial** - Had trial access but didn't convert to paid membership
- **Lead** - Never had any product (webinar attendee, waitlist, etc.)
- **Former BFF** - Completed BFF program but didn't continue with membership

**Implementation Notes:**
- May require historical product data or membership history tracking
- Could parse Tags for "Offboarding" + historical Products column
- Consider using `member_hiatus_history` pattern to track `member_product_history`

---

## Data Import

### Vision: Kajabi as Single Source of Truth Replica
**Goal:** Import ALL Kajabi data to own our data completely
- Build custom analytics impossible in Kajabi
- Track full member lifecycle (products, transactions, engagement)
- Enable migration off Kajabi in future if needed
- See full design: `docs/KAJABI_DATA_MODEL.md`

### Phase 1: Basic Member Data (✅ Current)
**Status:** Manual CSV exports weekly
**Data Sources:**
- Contacts CSV (Kajabi contact ID, email, name, tags, products)
- Subscriptions CSV (Stripe customer ID, subscription status, offers)

**What we track:**
- Member status (active, inactive, on_hiatus)
- Current products (denormalized string)
- External IDs for linking to Kajabi/Stripe

**Limitations:**
- Products not queryable (need to normalize)
- No transaction history
- No historical product access tracking
- Manual export process

### Phase 2A: Products Catalog (Next - Manual Setup)
**Goal:** Normalize product data to enable product-based queries

**Tasks:**
1. Create `kajabi_products` table (manual catalog of ~10 products)
2. Create `member_products` junction table (historical product access)
3. Update member processing to parse Products field into `member_products`
4. Seed known products:
   - Quill & Cup Membership (subscription)
   - 180 Program (includes Q&C Membership for 6 months)
   - Mindset Training
   - Self-Editing Academy
   - BFF Program
   - Hedgies on First Orientation
   - Chicago Retreat

**Enables:**
- "Show all members with 180 Program"
- "When did member join/leave BFF Program?"
- Product-based segmentation

**Effort:** Low (couple hours)
**Impact:** High (critical for product analytics)

### Phase 2B: Playwright Scraper (Next - Automation)
**Goal:** Automate export downloads to eliminate manual work

**Current Plan:**
- ❌ Kajabi API not available on current plan
- ✅ Build Playwright scraper to automate export downloads
- See designs: `docs/KAJABI_SCRAPER_DESIGN.md`, `docs/KAJABI_ZAPIER_ANALYSIS.md`

**Scraper will:**
1. Login to Kajabi (credentials in GitHub Secrets)
2. Navigate to export pages
3. Click "Export All" buttons
4. Download CSVs (same format as manual exports)
5. Upload to our app via existing `/api/import/*` endpoints
6. Trigger processing
7. Email only on failures

**Phase 2B.1: MVP Scraper (Week 1)**
- Export Contacts CSV
- Export Subscriptions CSV
- Upload both to app
- Run daily via GitHub Actions (free)

**Phase 2B.2: Add Transactions (Week 2)**
- Export Transactions CSV (`/sales/transactions`)
- Create `kajabi_transactions` table
- Import transaction history
- Enable LTV calculations, revenue analytics

**Phase 2B.3: Add Offers (Week 3)**
- Export Offers data (`/sales/offers` - per offer ID)
- Create `kajabi_offers` table
- Link offers to products
- Understand purchase bundles

**Effort:** 2-3 hours to build MVP, 1 hour per additional export
**Cost:** $0 (GitHub Actions free tier)
**Impact:** High (eliminate all manual work)

### Phase 3: Lead & Engagement Tracking (Future)
**Additional exports to consider:**

**Lead Tracking:**
- Form Submissions (`/marketing/forms` - per form)
- Opt-in Reports (`/analytics/opt-ins`)
- Understand lead sources and conversion funnel

**Engagement Tracking:**
- Product Progress (`/analytics/product-progress`)
- Course completion rates
- Student success metrics

**Effort:** Medium (1-2 hours per export type)
**Priority:** Lower (focus on core member/financial data first)

### Automated Daily Schedule
**Once scraper is built:**

1. **1:00 AM** - Kajabi scraper runs (GitHub Actions)
   - Downloads: Contacts, Subscriptions, Transactions, Offers
   - Uploads to app
   - Triggers processing

2. **2:00 AM** - Zoom meeting reports (future automation)
   - Download attendance data
   - Upload to app

3. **3:00 AM** - All processing complete
   - Email report with stats
   - Alert only on failures

**Cost:** $0 (GitHub Actions free tier handles this easily)

### Schedule Import
Import Prickles schedule from:
- Google Calendar API
- Slack integration
- Excel schedule (from Python app reference: `/Users/cody/codyaray/git/quillandcup/zoom-analytics`)

---

## Security & Access Control

### User Invitations
- **In-app invite management**
  - Admin page to send invites with pre-set roles
  - Email templates for invitations
  - Track invite status and expiration

### Row Level Security (RLS)
- **Role-based restrictions**
  - Add assistant/member roles when we have non-admin users
  - Update policies to restrict based on role
  - Test thoroughly before granting access to non-admins

### Role-Based Access Control (RBAC)
Define user roles and permissions:

1. **Member/Customer** (future)
   - View own profile and attendance history
   - Cannot access other members' data
   - Cannot access admin tools

2. **Admin** (current default)
   - Full access to all features
   - Import/process data
   - View all members and prickles
   - Edit members, prickles, aliases

3. **Assistant** (future)
   - Read-only access to member data for support
   - Can view attendance and engagement metrics
   - Cannot edit or delete
   - Cannot access import/process tools

4. **More granular roles** (future consideration)
   - Content Manager - manage prickles/calendar only
   - Analytics Viewer - read-only dashboards
   - Onboarding Specialist - member CRUD only

**Implementation:**
- Add `role` column to user profiles table
- Create RLS policies per role
- Update UI to show/hide features based on role
- Add role management interface for admins

---

## Analytics & Matching

### Member Matching Logic (In Progress)
Build fuzzy matching to connect Zoom attendance to members when emails aren't available:
- Name normalization (nicknames, variations)
- Manual mapping table for common aliases
- Confidence scoring

### Background Agents
Set up background agents for faster parallel development

---

## UI Enhancements

### Navigation & Layout
- **User settings - additional preferences**
  - Preferred theme (dark/light/device default)
  - Working location for global time analysis
  - Further refine navigation hierarchy and grouping

### Dashboard Improvements

**Needed Fixes:**
- Top Attendees list should link to each member's profile page
- At-Risk Members list should link to each member's profile page

**Potential Additions:**

1. **Recent Activity Feed**
   - Last 10-20 activities across all members
   - Types: New members, prickle attendance, hiatus starts/ends
   - Real-time or near-real-time updates

2. **Upcoming Prickles This Week**
   - Calendar preview of this week's scheduled prickles
   - Show host, type, time, expected attendance (based on historical avg)
   - Click to view prickle details or edit

3. **Host Leaderboard**
   - Top hosts by number of prickles hosted (last 30 days)
   - Host attendance/punctuality stats
   - Identify hosts who need support

4. **Attendance Trends Charts**
   - Line chart: Average attendance over time (30/60/90 days)
   - Bar chart: Attendance by prickle type
   - Heatmap: Popular prickle times (day/hour)

5. **Alerts & Notifications Panel**
   - Host no-shows this week (scheduled but didn't attend)
   - Members who just became at-risk
   - Data processing errors or warnings
   - Unmatched Zoom attendees count

6. **Member Lifecycle Summary**
   - New members this month
   - Members ending hiatus soon
   - Churned members (went inactive this month)

### Admin Features
- Manually create/edit members
- Manually create/edit Prickles
- Mark members for outreach

### Member Profile Pages
- **Attendance over time chart**
  - Show historical attendance patterns
  - Help identify engagement trends per member

- **Member status change tracking**
  - Track status transitions (active → hiatus → active, active → at-risk → active)
  - Show timeline: "Became at-risk: March 17", "Previously at-risk: Jan 5 - Jan 20 (returned after outreach)"
  - Helps validate at-risk detection and hiatus tracking
  - Shows engagement patterns over time
  - **Depends on:** Reliable hiatus data from Kajabi (see "Fix Hiatus Tracking" above)

- **Working location and timezone**
  - Configurable per member
  - Enable "local time" analysis (e.g., "most people write in evenings globally")
  - Show what local time members are attending from

### General Improvements
- Add favicon to the application

---

## Bug Fixes

### Member Filters
- **At-risk and highly-engaged filters don't work**
  - URL: `/dashboard/members?filter=highly_engaged`
  - Filter parameter is in URL but not applied to results
  - Both filters affected

---

## CRM Features

### Slack Integration (Phase 1: In Progress)
**Goal:** Track Slack engagement as another signal of community health

**Phase 1: Data Ingestion (Real-time Slack API)**
- Install Slack app with Events API
- Ingest: messages posted, reactions given/received, thread participation, channel activity, file uploads
- Store in `member_activities` table (already has slack_message, slack_reaction types)
- Bronze layer: `slack_events` (raw Slack events)
- Silver layer: Process into `member_activities`

**Phase 2: Member Profile Enhancement**
- Show Slack activity on member profile pages
  - "Posted 12 messages this month"
  - "Active in #accountability, #sprints"
  - Timeline of Slack engagement alongside Prickle attendance

**Phase 3: Combined Engagement Scoring**
- Calculate unified engagement score across Prickles + Slack + other activities
- Weight different activity types (Prickle attendance = 5, Slack message = 1, etc.)
- Display on dashboard and member profiles

**Phase 4: At-Risk Detection Enhancement**
- Use Slack activity as health signal
- Flag members who stopped posting (used to be active)
- Identify lurkers (attending Prickles but not engaging in Slack)
- Combined risk score: low Prickle attendance + low Slack activity

**Phase 5: Outreach Triggers & Alerts**
- "Alice hasn't posted in 14 days (usually posts 3x/week)"
- "Bob is very active in Slack but hasn't attended a Prickle in 30 days"
- Email/dashboard notifications for community managers

**Phase 6: Channel Health Metrics (Future)**
- Messages per day by channel
- Member participation rates
- Identify dead channels for archival

**Phase 7: Activity Feed (Future)**
- Live stream of community activity
- Recent Slack messages, reactions, file shares
- Combined with Prickle attendance
- Real-time or near-real-time updates
- Help admins stay connected to pulse of community

**Phase 1 Progress:**
- [x] Database migrations (Bronze tables, aliases extension)
- [x] Export script (batch CSV export)
- [x] Import API endpoint
- [x] Processing endpoint (Bronze → Silver)
- [x] Member matching library
- [ ] Data hygiene UI (unmatched users matching interface)
- [ ] Tests (reprocessability, idempotency, matching)
- [ ] Initial 30-day export and import
- [ ] Dashboard updates (member profiles, engagement scoring)

### Activity Feed Expansion (Future)
Beyond Slack, expand `member_activities` tracking:
- Whitepaper downloads
- Email opens/clicks
- Retreat registrations/attendance
- Community contributions

### Engagement Scoring
Refine `engagement_score` calculation based on activity types and recency
