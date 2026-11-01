import { describe, it, expect } from 'vitest';
import { loadVerifiedSlackLinks, matchSlackUsersToMembers } from '@/lib/slack-matching';
import { InMemoryDataset } from '@/lib/data/in-memory';
import { createInMemoryRepos } from '@/lib/data/repos';
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
    const repos = createInMemoryRepos(
      new InMemoryDataset({
        slackConnections: [
          {
            slack_user_id: 'U9',
            member_id: 'member-2',
            connected_at: '2026-01-01T00:00:00Z',
            revoked_at: '2026-02-01T00:00:00Z',
            scopes: [],
            access_secret_id: null,
            refresh_secret_id: null,
            expires_at: null,
            read_pulled_at: null,
            team_id: null,
          },
        ],
      })
    );

    const links = await loadVerifiedSlackLinks(repos);

    expect([...links]).toEqual([['U9', 'member-2']]);
  });

  it('should fail loudly when the connections cannot be read', async () => {
    const repos = createInMemoryRepos();
    repos.memberProfile.slackUserLinks = async () => {
      throw new Error('down');
    };

    await expect(loadVerifiedSlackLinks(repos)).rejects.toThrow('down');
  });
});
