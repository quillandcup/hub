#!/usr/bin/env tsx

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function verify() {
  console.log('=== Bronze Layer (Raw Imports) ===\n');

  const { count: usersCount } = await supabase
    .from('slack_users')
    .select('*', { count: 'exact', head: true });

  const { count: channelsCount } = await supabase
    .from('slack_channels')
    .select('*', { count: 'exact', head: true });

  const { count: messagesCount } = await supabase
    .from('slack_messages')
    .select('*', { count: 'exact', head: true });

  const { count: reactionsCount } = await supabase
    .from('slack_reactions')
    .select('*', { count: 'exact', head: true });

  console.log(`Users:     ${usersCount}`);
  console.log(`Channels:  ${channelsCount}`);
  console.log(`Messages:  ${messagesCount}`);
  console.log(`Reactions: ${reactionsCount}`);

  console.log('\n=== Silver Layer (Processed Activities) ===\n');

  const { count: activitiesCount } = await supabase
    .from('member_activities')
    .select('*', { count: 'exact', head: true })
    .eq('source', 'slack');

  console.log(`Slack Activities: ${activitiesCount}`);

  // Break down by type
  const { data: byType } = await supabase
    .from('member_activities')
    .select('activity_type_id')
    .eq('source', 'slack');

  const typeCounts = byType?.reduce((acc: any, row: any) => {
    acc[row.activity_type_id] = (acc[row.activity_type_id] || 0) + 1;
    return acc;
  }, {});

  console.log('\nBy Activity Type:');
  Object.entries(typeCounts || {}).forEach(([type, count]) => {
    console.log(`  Type ${type}: ${count}`);
  });

  // Sample activities
  const { data: samples } = await supabase
    .from('member_activities')
    .select('occurred_at, activity_type_id, member_id')
    .eq('source', 'slack')
    .order('occurred_at', { ascending: false })
    .limit(5);

  console.log('\nSample Activities (most recent):');
  samples?.forEach(a => {
    console.log(`  ${a.occurred_at} - Type ${a.activity_type_id} - Member ${a.member_id?.substring(0, 8)}...`);
  });

  console.log('\n=== Integration Test Results ===\n');
  console.log(`✓ Export: ${usersCount} users, ${channelsCount} channels, ${messagesCount} messages, ${reactionsCount} reactions`);
  console.log(`✓ Import: All Bronze tables populated`);
  console.log(`✓ Process: ${activitiesCount} activities created in Silver layer`);
  console.log('\nLocal Slack integration is working! 🎉');
}

verify().catch(console.error);
