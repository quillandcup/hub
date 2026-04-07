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

### User Invitations
- ✅ **DONE: Disabled public signups**
  - Set `enable_signup = false` in `supabase/config.toml`
  - Admins invite users through Supabase Studio
  - See `docs/INVITING_USERS.md` for instructions
- **TODO: In-app invite management (future)**
  - Admin page to send invites with pre-set roles
  - Email templates for invitations
  - Track invite status and expiration

### Row Level Security (RLS)
- ✅ **DONE: Basic RLS enabled on all tables**
  - All tables have RLS enabled
  - Authenticated users get full access (all are admins for now)
  - user_profiles table created with role column
  - Helper functions and auto-profile creation in place
  - See `docs/RLS_SECURITY.md` for details
- **TODO: Implement role-based restrictions when needed**
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
- **Collapsible left-nav with information hierarchy**
  - Current state: Jumble of inter-linked tools (dashboard → name matching → search-based matching)
  - Goal: Clear, organized navigation with logical grouping
  - Consider sections: Dashboard, Members, Prickles, Import/Process, Admin Tools

- **Mobile navigation issues**
  - On mobile, user's email dropdown in top-right overlaps left-nav collapse arrow
  - Makes it impossible to collapse nav in vertical orientation (nav takes up most of screen)
  - Nav should start collapsed on mobile by default

- **User profile dropdown in top-nav**
  - Replace simple "Sign out" link with dropdown menu
  - Add "Edit Profile" link
  - First setting: Default timezone preference
  - Option for "Browser/Local Time" to auto-detect
  - Store user preferences in database

- **User settings page**
  - Preferred theme (dark/light/device default)
  - Timezone preference (becomes default on calendar and other timezone dropdowns)
  - Working location and timezone for global time analysis
  - Store preferences in user_profiles table

### Dashboard Improvements

**Current State:**
The dashboard has basic stats cards, at-risk members list, and engagement insights.

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
  
- **Display member's aliases**
  - Show list of configured name aliases for this member
  - Read-only display (no ability to add aliases from member page)
  - Link to name matching page for alias management

- **Working location and timezone**
  - Configurable per member
  - Enable "local time" analysis (e.g., "most people write in evenings globally")
  - Show what local time members are attending from

### General Improvements
- Add favicon to the application

---

## Bug Fixes

### Attendance Counting
- ✅ **FIXED: Leave/rejoin counted as multiple attendees**
  - Prickle details page now counts unique members, not attendance records
  - Shows note when members left and rejoined: "X total records (some members left and rejoined)"
  - Note: attendance table allows multiple records per (member_id, prickle_id) by design to track leave/rejoin patterns

### Prickle Types
- ✅ **FIXED: Edit prickle type route**
  - Route is at `/data/prickle-types/{id}/edit` (not `/dashboard/prickle-types/{id}/edit`)
  - Working correctly

### Host Processing
- ✅ **FIXED: Host assignment broken on Progress Prickles**
  - Bug: When extracting host from "Prickle w/Lili", code incorrectly tried to match using organizer email (calendar account) instead of just the extracted name "Lili"
  - Fix: Only use organizer/creator email when no host extracted from "w/Name" pattern
  - Before: 85.8% without host (308/359). After fix, should match most hosts via aliases or name matching
  - Reprocess calendar events to apply fix

### Member Filters
- **At-risk and highly-engaged filters don't work**
  - URL: `/dashboard/members?filter=highly_engaged`
  - Filter parameter is in URL but not applied to results
  - Both filters affected

### Incomplete TODO
- "Members attend" - Note: This TODO was incomplete/cut off. Needs clarification.

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
