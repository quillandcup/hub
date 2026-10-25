import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The demo community's chat: four Hub-native channels with a few days of friendly, fictional conversation, threads
 * and reactions, and a few messages the demo member hasn't read yet (so the sidebar shows unread counts). Written
 * straight into the chat tables (Local layer) as app-only channels; production mirrors Slack into the same tables
 * (docs/SLACK_BRIDGED_CHAT.md). The `chat` feature is switched on for everyone in the demo; `chat_posting` stays off.
 */

interface DemoReply {
  by: string;
  minutesAfter: number;
  body: string;
}

interface DemoMessage {
  by: string;
  hoursAgo: number;
  body: string;
  reactions?: { emoji: string; by: string[] }[];
  replies?: DemoReply[];
}

interface DemoChannel {
  name: string;
  topic: string;
  /** Hours ago the demo member last read this channel; messages after it show as unread. */
  readHoursAgo: number;
  messages: DemoMessage[];
}

export const DEMO_CHANNELS: DemoChannel[] = [
  {
    name: "start-here",
    topic: "New here? Say hello and tell us what you're writing.",
    readHoursAgo: 1,
    messages: [
      {
        by: "Hazel Hosting",
        hoursAgo: 70,
        body: "Welcome, everyone! Say hi and tell us one thing you're working on this week. No project is too small.",
        reactions: [
          { emoji: "wave", by: ["Marlowe Example", "Jules Sample", "Rowan Demo"] },
          { emoji: "heart", by: ["Wren Placeholder", "Sage Sample"] },
        ],
        replies: [
          { by: "Marlowe Example", minutesAfter: 25, body: "Hi! Drafting a cozy mystery set in a lighthouse bakery. Three weeks in and loving the Prickles." },
          { by: "Rowan Demo", minutesAfter: 80, body: "Plotting my first novel. Plot or Plan Prickles are the best hour of my week." },
          { by: "Hazel Hosting", minutesAfter: 95, body: "Two wonderful ideas. A lighthouse bakery is exactly the kind of place a body turns up." },
        ],
      },
    ],
  },
  {
    name: "daily-wins",
    topic: "Share the words, big or small.",
    readHoursAgo: 30,
    messages: [
      {
        by: "Jules Sample",
        hoursAgo: 26,
        body: "Finished a sonnet during this morning's Sprint Prickle. Fourteen lines, only two of them terrible.",
        reactions: [{ emoji: "tada", by: ["Marlowe Example", "Hazel Hosting", "Ash Fictional", "Wren Placeholder"] }],
        replies: [
          { by: "Ash Fictional", minutesAfter: 12, body: "Two out of fourteen is a great ratio. Revision will sort the rest." },
          { by: "Jules Sample", minutesAfter: 40, body: "Revision is tomorrow's problem. Today I'm just enjoying it." },
        ],
      },
      {
        by: "Wren Placeholder",
        hoursAgo: 20,
        body: "1,200 words before breakfast. The Progress Prickle at 9 is doing more for me than coffee.",
        reactions: [
          { emoji: "raised_hands", by: ["Marlowe Example", "Jules Sample"] },
          { emoji: "coffee", by: ["Sage Sample"] },
        ],
      },
      {
        by: "Hazel Hosting",
        hoursAgo: 5,
        body: "Chapter 12 revised and sent to my critique partner. Please hold my hand while I wait for her reply.",
        reactions: [{ emoji: "hugging_face", by: ["Marlowe Example", "Rowan Demo", "Clover Sketch"] }],
        replies: [{ by: "Rowan Demo", minutesAfter: 18, body: "Holding it. Sprint Prickle tonight, if you want company while you wait?" }],
      },
    ],
  },
  {
    name: "craft-talk",
    topic: "Plot, voice, pacing, and the stubborn middle.",
    readHoursAgo: 48,
    messages: [
      {
        by: "Rowan Demo",
        hoursAgo: 40,
        body: "How do you all keep a mystery's middle from sagging? Mine turns into people drinking tea and explaining things.",
        reactions: [{ emoji: "thinking_face", by: ["Wren Placeholder", "Fern Imaginary"] }],
        replies: [
          { by: "Hazel Hosting", minutesAfter: 30, body: "Give every scene a question the reader wants answered, and don't answer it until the next scene starts a bigger one." },
          { by: "Wren Placeholder", minutesAfter: 55, body: "Also: someone should want something and be stopped from getting it, even if they're only making toast." },
          { by: "Marlowe Example", minutesAfter: 120, body: "Saving this thread. The toast one is going on a sticky note." },
        ],
      },
      {
        by: "Briar Demo",
        hoursAgo: 9,
        body: "Does anyone else read their draft aloud? I caught three clunky sentences in ten minutes today.",
        reactions: [{ emoji: "ear", by: ["Jules Sample", "Maple Pretend"] }],
        replies: [{ by: "Jules Sample", minutesAfter: 22, body: "Every time. Poets can't help it. Your ear catches what your eyes forgive." }],
      },
    ],
  },
  {
    name: "prickle-chatter",
    topic: "Before and after the sprints.",
    readHoursAgo: 12,
    messages: [
      {
        by: "Thistle Mockup",
        hoursAgo: 8,
        body: "Anyone joining the 7pm Sprint Prickle tonight? I need accountability and a witness.",
        reactions: [{ emoji: "raised_hand", by: ["Hazel Hosting", "Rowan Demo", "Marlowe Example"] }],
        replies: [
          { by: "Hazel Hosting", minutesAfter: 6, body: "Hosting it. Bring a drink and a goal." },
          { by: "Rowan Demo", minutesAfter: 15, body: "In. My goal is 500 words and not reorganizing my notes again." },
        ],
      },
      {
        by: "Hazel Hosting",
        hoursAgo: 3,
        body: "Reminder: Progress Prickle tomorrow at 9. New faces especially welcome.",
        reactions: [{ emoji: "sunrise", by: ["Marlowe Example", "Wren Placeholder"] }],
      },
    ],
  },
];

/** Turn the chat features on and write the channels, their members, messages, threads and reactions. Replaced on every run. */
export async function seedChat(admin: SupabaseClient, now: Date) {
  // Reading is on; posting stays off because the demo has no Slack to post through (it would answer "isn't connected").
  const { error: flagError } = await admin
    .from("feature_flags")
    .upsert([{ feature_key: "chat", enabled_globally: true }, { feature_key: "chat_posting", enabled_globally: false }], { onConflict: "feature_key" });
  if (flagError) throw new Error(`feature_flags: ${flagError.message}`);

  const { data: members, error: membersError } = await admin.from("members").select("id, name, email");
  if (membersError) throw new Error(`members: ${membersError.message}`);
  const byName = new Map((members ?? []).map((m) => [m.name as string, m.id as string]));
  const id = (name: string) => {
    const found = byName.get(name);
    if (!found) throw new Error(`chat seed: no demo member named ${name}`);
    return found;
  };
  const at = (hoursAgo: number, minutes = 0) => new Date(now.getTime() - hoursAgo * 3_600_000 + minutes * 60_000).toISOString();

  // Replaced on every run: only the demo's own channels, which are app-only and named in DEMO_CHANNELS.
  const { error: wipeError } = await admin
    .from("chat_channels")
    .delete()
    .eq("bridge_mode", "app_only")
    .in("name", DEMO_CHANNELS.map((c) => c.name));
  if (wipeError) throw new Error(`chat_channels clear: ${wipeError.message}`);

  const demoMember = id("Marlowe Example");
  const everyone = [...byName.values()];

  for (const channel of DEMO_CHANNELS) {
    const { data: created, error: channelError } = await admin
      .from("chat_channels")
      .insert({ kind: "channel", bridge_mode: "app_only", visibility: "public", name: channel.name, topic: channel.topic, created_at: at(24 * 30) })
      .select("id")
      .single();
    if (channelError || !created) throw new Error(`chat_channels ${channel.name}: ${channelError?.message}`);

    const { error: memberError } = await admin.from("chat_channel_members").insert(
      everyone.map((member_id) => ({
        channel_id: created.id,
        member_id,
        source: "app",
        joined_at: at(24 * 30),
        last_read_at: member_id === demoMember ? at(channel.readHoursAgo) : at(0),
      })),
    );
    if (memberError) throw new Error(`chat_channel_members ${channel.name}: ${memberError.message}`);

    for (const message of channel.messages) {
      const replies = message.replies ?? [];
      const lastReply = replies.length ? replies[replies.length - 1] : undefined;
      const { data: root, error: rootError } = await admin
        .from("chat_messages")
        .insert({
          channel_id: created.id,
          author_member_id: id(message.by),
          origin: "app",
          created_at: at(message.hoursAgo),
          reply_count: replies.length,
          last_reply_at: lastReply ? at(message.hoursAgo, lastReply.minutesAfter) : null,
        })
        .select("id")
        .single();
      if (rootError || !root) throw new Error(`chat_messages ${channel.name}: ${rootError?.message}`);
      const contents = [{ message_id: root.id, body: message.body }];

      for (const reply of replies) {
        const { data: row, error: replyError } = await admin
          .from("chat_messages")
          .insert({
            channel_id: created.id,
            author_member_id: id(reply.by),
            thread_root_id: root.id,
            origin: "app",
            created_at: at(message.hoursAgo, reply.minutesAfter),
          })
          .select("id")
          .single();
        if (replyError || !row) throw new Error(`chat reply ${channel.name}: ${replyError?.message}`);
        contents.push({ message_id: row.id, body: reply.body });
      }

      const { error: contentError } = await admin.from("chat_message_contents").insert(contents);
      if (contentError) throw new Error(`chat_message_contents ${channel.name}: ${contentError.message}`);

      const reactions = (message.reactions ?? []).flatMap((r) =>
        r.by.map((name) => ({ message_id: root.id, channel_id: created.id, member_id: id(name), emoji: r.emoji, created_at: at(message.hoursAgo, 5) })),
      );
      if (reactions.length > 0) {
        const { error: reactionError } = await admin.from("chat_reactions").insert(reactions);
        if (reactionError) throw new Error(`chat_reactions ${channel.name}: ${reactionError.message}`);
      }
    }
  }
}
