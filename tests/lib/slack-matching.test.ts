import { describe, it, expect } from 'vitest';
import { loadVerifiedSlackLinks, matchSlackUsersToMembers } from '@/lib/slack-matching';
import type { MemberAlias } from '@/lib/member-matching';

describe('Slack User Matching', () => {
  const members = [
    { id: 'member-1', name: 'Alice Johnson', email: 'alice@example.com' },
    { id: 'member-2', name: 'Bob Smith', email: 'bob@example.com' },
  ];

  const aliases: MemberAlias[] = [
    { member_id: 'member-1', alias: 'U_ALICE_MANUAL', source: 'slack' },
  ];

  it('should match by email (high confidence)', async () => {
    const slackUsers = [
      { user_id: 'U001', email: 'alice@example.com', real_name: 'Alice J' },
    ];

    const map = await matchSlackUsersToMembers(slackUsers, members, aliases);

    expect(map.get('U001')).toBe('member-1');
  });

  it('should match by normalized name when email missing', async () => {
    const slackUsers = [
      { user_id: 'U002', email: null, real_name: 'Bob Smith' },
    ];

    const map = await matchSlackUsersToMembers(slackUsers, members, aliases);

    expect(map.get('U002')).toBe('member-2');
  });

  it('should match by manual alias (highest priority)', async () => {
    const slackUsers = [
      { user_id: 'U_ALICE_MANUAL', email: 'different@example.com', real_name: 'Totally Different' },
    ];

    const map = await matchSlackUsersToMembers(slackUsers, members, aliases);

    expect(map.get('U_ALICE_MANUAL')).toBe('member-1'); // Manual alias wins over email
  });

  it('should not match when no email and no name similarity', async () => {
    const slackUsers = [
      { user_id: 'U003', email: null, real_name: 'Unknown User' },
    ];

    const map = await matchSlackUsersToMembers(slackUsers, members, aliases);

    expect(map.has('U003')).toBe(false);
  });

  it('should let a verified link outrank alias, email and name', async () => {
    const slackUsers = [
      { user_id: 'U_ALICE_MANUAL', email: 'alice@example.com', real_name: 'Alice Johnson' },
      { user_id: 'U_NEW', email: null, real_name: 'Someone Else' },
    ];
    const verified = new Map([
      ['U_ALICE_MANUAL', 'member-2'],
      ['U_NEW', 'member-1'],
    ]);

    const map = await matchSlackUsersToMembers(slackUsers, members, aliases, verified);

    expect(map.get('U_ALICE_MANUAL')).toBe('member-2');
    expect(map.get('U_NEW')).toBe('member-1');
  });

  it('should read verified links from the connections, kept after a disconnect', async () => {
    const range = async () => ({ data: [{ slack_user_id: 'U9', member_id: 'member-2' }], error: null });
    const supabase = { from: (table: string) => ({ select: () => ({ order: () => ({ range: table === 'member_slack_connections' ? range : undefined }) }) }) };

    const links = await loadVerifiedSlackLinks(supabase as never);

    expect([...links]).toEqual([['U9', 'member-2']]);
  });

  it('should fail loudly when the connections cannot be read', async () => {
    const supabase = { from: () => ({ select: () => ({ order: () => ({ range: async () => ({ data: null, error: { message: 'down' } }) }) }) }) };

    await expect(loadVerifiedSlackLinks(supabase as never)).rejects.toThrow('down');
  });
});
