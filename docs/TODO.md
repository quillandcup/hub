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

### Dashboard Improvements
- Charts/graphs for engagement trends
- Member activity timeline
- Risk alerts and notifications

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
