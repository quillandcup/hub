import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const adminPageSrc = fs.readFileSync(
  path.join(process.cwd(), 'app/(admin)/admin/prickles/[id]/page.tsx'),
  'utf-8'
);

const memberPageSrc = fs.readFileSync(
  path.join(process.cwd(), 'app/(member)/prickles/[id]/page.tsx'),
  'utf-8'
);

describe('Admin prickle detail page routing', () => {
  it('exists at the admin route path', () => {
    const exists = fs.existsSync(
      path.join(process.cwd(), 'app/(admin)/admin/prickles/[id]/page.tsx')
    );
    expect(exists).toBe(true);
  });

  it('back link points to /admin/calendar', () => {
    expect(adminPageSrc).toContain('/admin/calendar');
    expect(adminPageSrc).not.toMatch(/href="\/calendar"/);
  });

  it('uses /admin/members for member links', () => {
    expect(adminPageSrc).toContain('memberBasePath="/admin/members"');
    expect(adminPageSrc).not.toContain('memberBasePath="/members"');
  });

  it('always shows member emails', () => {
    expect(adminPageSrc).toContain('showMemberEmails={true}');
    expect(adminPageSrc).not.toContain('showMemberEmails={false}');
    expect(adminPageSrc).not.toContain('showMemberEmails={isActingAsAdmin}');
  });

  it('always fetches unmatched zoom attendees (no conditional guard)', () => {
    expect(adminPageSrc).toContain('findUnmatchedZoomAttendees');
    expect(adminPageSrc).not.toContain('if (isActingAsAdmin');
  });

  it('fetches all members for unmatched matching, not just active ones', () => {
    // Filtering to active-only causes names matching inactive members to appear
    // as unmatched on this page but not on the main unmatched-zoom page.
    expect(adminPageSrc).not.toMatch(/"members"[^;]*\.eq\("status",\s*"active"\)/);
    expect(adminPageSrc).not.toContain('.eq("status", "active")');
  });

  it('fetches historical meeting counts to populate appearances for unmatched names', () => {
    // The in-prickle record count (usually 1) mismatches the modal which shows
    // all-time prickles. We batch-fetch historical meeting_uuid counts instead.
    expect(adminPageSrc).toContain('historicalMeetings');
    expect(adminPageSrc).toContain('meeting_uuid');
    expect(adminPageSrc).toContain('a.appearances');
  });

  it('imports PrickleDetails from shared components directory', () => {
    expect(adminPageSrc).toContain('@/components/PrickleDetails');
  });
});

describe('PrickleDetails component location', () => {
  it('is in the shared components directory', () => {
    const exists = fs.existsSync(
      path.join(process.cwd(), 'components/PrickleDetails.tsx')
    );
    expect(exists).toBe(true);
  });

  it('is no longer in the member route group', () => {
    const exists = fs.existsSync(
      path.join(process.cwd(), 'app/(member)/prickles/[id]/PrickleDetails.tsx')
    );
    expect(exists).toBe(false);
  });

  it('member prickle page imports from shared components', () => {
    expect(memberPageSrc).toContain('@/components/PrickleDetails');
    expect(memberPageSrc).not.toContain('./PrickleDetails');
  });
});
