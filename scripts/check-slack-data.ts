#!/usr/bin/env tsx

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function checkData() {
  // Check Bronze layer
  const { count: usersCount } = await supabase
    .from('slack_users')
    .select('*', { count: 'exact', head: true });

  const { count: messagesCount } = await supabase
    .from('slack_messages')
    .select('*', { count: 'exact', head: true });

  const { count: reactionsCount } = await supabase
    .from('slack_reactions')
    .select('*', { count: 'exact', head: true });

  // Check Silver layer
  const { count: activitiesCount } = await supabase
    .from('member_activities')
    .select('*', { count: 'exact', head: true })
    .eq('source', 'slack');

  console.log('Bronze Layer:');
  console.log(`  Users: ${usersCount}`);
  console.log(`  Messages: ${messagesCount}`);
  console.log(`  Reactions: ${reactionsCount}`);
  console.log();
  console.log('Silver Layer:');
  console.log(`  Slack Activities: ${activitiesCount}`);

  // Sample activities
  const { data: sampleActivities } = await supabase
    .from('member_activities')
    .select('id, member_id, activity_type_id, occurred_at, metadata')
    .eq('source', 'slack')
    .order('occurred_at', { ascending: false })
    .limit(3);

  console.log();
  console.log('Sample Activities:');
  sampleActivities?.forEach(a => {
    console.log(`  ${a.occurred_at} - Type ${a.activity_type_id} - Member ${a.member_id}`);
  });
}

checkData().catch(console.error);
