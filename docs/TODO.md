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

### Automated Daily Imports
**Goal:** Stop manually babysitting data - automate the entire pipeline

**Priority 1: Daily Cron Jobs**
- Kajabi CSV import (daily at 2 AM)
- Zoom meeting/attendee reports (daily at 3 AM)
- Auto-trigger processing after imports complete
- Email alerts only on failures

**Priority 2: Kajabi API Integration**
Replace CSV import with direct Kajabi API integration when API access is enabled on plan:
- Real-time sync via API
- Automatic status updates
- Webhook support for member changes
- Eliminates manual CSV export/upload

**Research: Community Analytics Tools**
Explore for ideas/inspiration (NOT to replace, just learn from):
- Orbit - community analytics
- Common Room - member engagement tracking
- Goal: Mine for feature ideas, UX patterns, analytics approaches
- Keep building custom solution (more fun, free for small community)

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

### Activity Feed
Expand `member_activities` tracking:
- Whitepaper downloads
- Slack messages/reactions
- Email opens/clicks
- Retreat registrations/attendance
- Community contributions

### Engagement Scoring
Refine `engagement_score` calculation based on activity types and recency
