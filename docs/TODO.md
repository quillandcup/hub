# TODO / Future Enhancements

## Member Status Refinements

### Reverify Hiatus Members After Kajabi/SOP Updates
After updating Kajabi data and SOPs to ensure Offboarding tags are consistently applied:
- Re-import member data from Kajabi
- Verify on_hiatus count matches expected hiatus members
- Cross-reference with manual hiatus spreadsheet
- ~21 members identified as needing Offboarding tag (hiatus ended, didn't resubscribe)

**Current Status Detection Logic:**
- Active: has "Quill & Cup Membership" product
- On Hiatus: has "Quill & Cup Member" tag but no product AND no "Offboarding" tag
- Inactive: has "Offboarding" tag OR neither product nor member tag

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

### Kajabi API Integration
Replace CSV import with direct Kajabi API integration when API access is enabled on plan.
- Real-time sync
- Automatic status updates
- Webhook support for member changes

### Schedule Import
Import Prickles schedule from:
- Google Calendar API
- Slack integration
- Excel schedule (from Python app reference: `/Users/cody/codyaray/git/quillandcup/zoom-analytics`)

---

## Security & Access Control

### Row Level Security (RLS)
- **CRITICAL: Setup RLS policies in Supabase**
  - Currently completely insecure - any authenticated user can access all data
  - Define policies per table based on user role
  - Test policies thoroughly before production

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
- **Collapsible left-nav with information hierarchy**
  - Current state: Jumble of inter-linked tools (dashboard → name matching → search-based matching)
  - Goal: Clear, organized navigation with logical grouping
  - Consider sections: Dashboard, Members, Prickles, Import/Process, Admin Tools

- **User profile dropdown in top-nav**
  - Replace simple "Sign out" link with dropdown menu
  - Add "Edit Profile" link
  - First setting: Default timezone preference
  - Option for "Browser/Local Time" to auto-detect
  - Store user preferences in database

### Dashboard Improvements

**Current State:**
The dashboard has basic stats cards, at-risk members list, and engagement insights.

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

5. **Quick Actions / Shortcuts**
   - "Import Zoom Data" button
   - "Process Attendance" button
   - "View Unmatched Events" button
   - Jump to common admin tasks

6. **Alerts & Notifications Panel**
   - Host no-shows this week (scheduled but didn't attend)
   - Members who just became at-risk
   - Data processing errors or warnings
   - Unmatched Zoom attendees count

7. **Member Lifecycle Summary**
   - New members this month
   - Members ending hiatus soon
   - Churned members (went inactive this month)

### Admin Features
- Manually create/edit members
- Manually create/edit Prickles
- Mark members for outreach

---

## CRM Features

### Activity Feed
Expand `member_activities` tracking:
- Whitepaper downloads
- Slack messages/reactions
- Email opens/clicks
- Retreat registrations/attendance
- Community contributions

### Engagement Scoring
Refine `engagement_score` calculation based on activity types and recency
