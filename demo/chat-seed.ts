import type { SupabaseClient } from "@supabase/supabase-js";
import { COMMUNITY } from "@/lib/data/profiles/community";
import { SLACK_FILES_BUCKET } from "@/lib/slack-capture";
import { animatedGif, bouncingDisc, DISC_PALETTE } from "./gif";

/**
 * The demo community's chat: four channels with a few days of friendly, fictional conversation, threads and
 * reactions, and a few messages the demo member hasn't read yet (so the sidebar shows unread counts). Written
 * straight into the chat tables (Local layer) as bridged channels with made-up Slack ids; production mirrors Slack
 * into the same tables (docs/SLACK_BRIDGED_CHAT.md). The `chat` and `chat_posting` features are on for everyone in
 * the demo, and the demo member has a (token-less) Slack connection, so the composer works: a post is saved as the
 * member and, with no Slack to send it to, stays pending until the recording marks it sent (slack-stand-in.ts).
 */

/** A member's name, from the community profile (lib/data/profiles/community.ts) by the key its people go by ("member", "host"), so renaming someone there renames them in the chat. */
export function who(key: string): string {
  const person = COMMUNITY.people.find((p) => p.key === key);
  if (!person) throw new Error(`The community profile has no person "${key}"`);
  return person.name;
}

/** Slack ids of the demo are made up and start with this, so a re-run can tell its own channels from real ones. */
export const DEMO_SLACK_PREFIX = "CDEMO";

interface DemoReply {
  by: string;
  minutesAfter: number;
  body: string;
}

/** An animated emoji the demo workspace "uploaded": reactions use it, and the animations-off scene checks it is a still. */
export const DEMO_ANIMATED_EMOJI = "party_disc";
/** A GIF attached to a message, with the file id it has in the Slack copy table. */
const DEMO_GIF = { id: "FDEMO0000001", name: "party-disc.gif", size: 160 };

interface DemoMessage {
  by: string;
  hoursAgo: number;
  body: string;
  /** Attach the demo's animated GIF. */
  gif?: boolean;
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
    name: "announcements",
    topic: "News from the hosts. Quiet on purpose.",
    readHoursAgo: 1,
    messages: [
      {
        by: who("host"),
        hoursAgo: 22,
        body: "📣 Chat is live in the Hub! Same conversations as Slack, searchable forever, and you can post right from here. Say hi in #start-here 💬",
        reactions: [
          { emoji: "tada", by: [who("member"), who("regular1"), who("regular2"), who("willa")] },
          { emoji: "heart", by: [who("sadie"), who("aria")] },
        ],
        replies: [
          { by: who("member"), minutesAfter: 12, body: "yesss, one less app to juggle between sprints 🙌" },
          { by: who("regular1"), minutesAfter: 31, body: "the search is going to save me. I lose every good tip I've ever been given 😅" },
        ],
      },
      {
        by: who("host"),
        hoursAgo: 2,
        body: "🌙 Tonight's Sprint Prickle is at 7pm ET. Bring a snack, a tiny goal, and your best \"one more sentence\" energy.",
        reactions: [{ emoji: "crescent_moon", by: [who("member"), who("regular2"), who("thea")] }],
      },
    ],
  },
  {
    name: "start-here",
    topic: "New here? Say hello and tell us what you're writing.",
    readHoursAgo: 1,
    messages: [
      {
        by: who("host"),
        hoursAgo: 70,
        body: "welcome to the burrow, friend! 🦔 tell us what you're working on and your current word count (or just your vibe). no project is too small",
        reactions: [
          { emoji: "wave", by: [who("member"), who("regular1"), who("regular2")] },
          { emoji: "heart", by: [who("willa"), who("sadie")] },
        ],
        replies: [
          { by: who("member"), minutesAfter: 25, body: "hiii! drafting a cozy mystery set in a lighthouse bakery 🧁 three weeks in and obsessed with the Prickles" },
          { by: who("regular2"), minutesAfter: 80, body: "plotting my very first novel 📓 Plot or Plan Prickles are my favorite hour of the week" },
          { by: who("host"), minutesAfter: 95, body: "a lighthouse bakery is EXACTLY the kind of place a body turns up 😏 welcome, both of you!" },
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
        by: who("willa"),
        hoursAgo: 31,
        body: "my word-count celebration dance, in GIF form 💃",
        gif: true,
        reactions: [{ emoji: DEMO_ANIMATED_EMOJI, by: [who("member"), who("regular1"), who("host")] }],
      },
      {
        by: who("regular1"),
        hoursAgo: 26,
        body: "finished a sonnet during this morning's Sprint Prickle ✨ fourteen lines, only two of them terrible",
        reactions: [{ emoji: "tada", by: [who("member"), who("host"), who("aria"), who("willa")] }],
        replies: [
          { by: who("aria"), minutesAfter: 12, body: "two out of fourteen is a GREAT ratio. revision will sort the rest 💛" },
          { by: who("regular1"), minutesAfter: 40, body: "revision is tomorrow's problem. today I'm just enjoying it 🌷" },
        ],
      },
      {
        by: who("willa"),
        hoursAgo: 20,
        body: "1,200 words before breakfast?? the 9am Progress Prickle is doing more for me than coffee ☕",
        reactions: [
          { emoji: "raised_hands", by: [who("member"), who("regular1")] },
          { emoji: "coffee", by: [who("sadie")] },
        ],
      },
      {
        by: who("host"),
        hoursAgo: 5,
        body: "chapter 12 revised and sent to my critique partner 😬 please hold my hand while I wait for her reply",
        reactions: [{ emoji: "hugging_face", by: [who("member"), who("regular2"), who("clover")] }],
        replies: [{ by: who("regular2"), minutesAfter: 18, body: "holding it!! Sprint Prickle tonight if you want company while you wait? 🫶" }],
      },
    ],
  },
  {
    name: "craft-talk",
    topic: "Plot, voice, pacing, and the stubborn middle.",
    readHoursAgo: 48,
    messages: [
      {
        by: who("regular2"),
        hoursAgo: 40,
        body: "ok writers: how do you keep the middle of a mystery from sagging?? mine is just people drinking tea and explaining things 😭",
        reactions: [{ emoji: "thinking_face", by: [who("willa"), who("fern")] }],
        replies: [
          { by: who("host"), minutesAfter: 30, body: "give every scene a question the reader wants answered, and don't answer it until the next scene starts a bigger one" },
          { by: who("willa"), minutesAfter: 55, body: "also: someone should want something and be stopped from getting it, even if they're only making toast 🍞" },
          { by: who("member"), minutesAfter: 120, body: "saving this thread. the toast one is going on a sticky note 📌" },
        ],
      },
      {
        by: who("briony"),
        hoursAgo: 9,
        body: "does anyone else read their draft out loud? I caught three clunky sentences in ten minutes today 🎧",
        reactions: [{ emoji: "ear", by: [who("regular1"), who("mabel")] }],
        replies: [{ by: who("regular1"), minutesAfter: 22, body: "every single time (poet problems). your ear catches what your eyes forgive 💫" }],
      },
    ],
  },
  {
    name: "prickle-chatter",
    topic: "Before and after the sprints.",
    readHoursAgo: 12,
    messages: [
      {
        by: who("thea"),
        hoursAgo: 8,
        body: "anyone joining the 7pm Sprint Prickle tonight? I need accountability and a witness 👀",
        reactions: [{ emoji: "raised_hand", by: [who("host"), who("regular2"), who("member")] }],
        replies: [
          { by: who("host"), minutesAfter: 6, body: "hosting it! bring a drink and a goal 🍵" },
          { by: who("regular2"), minutesAfter: 15, body: "in. my goal is 500 words and NOT reorganizing my notes again 🙈" },
        ],
      },
      {
        by: who("host"),
        hoursAgo: 3,
        body: "reminder: Progress Prickle tomorrow at 9 ☀️ new faces especially welcome!",
        reactions: [{ emoji: "sunrise", by: [who("member"), who("willa")] }],
      },
    ],
  },
];

const DEMO_GIF_PATH = "demo/party-disc.gif";
const EMOJI_BUCKET = "demo-emoji";

/**
 * The two animated images: the attachment goes in the private slack-files bucket where the chat's file route
 * reads it (its `slack_files` row says it is already copied, so no Slack is needed), and the emoji in a public
 * bucket, which is what a workspace's emoji CDN is to the browser (a cross-origin image served with CORS).
 */
async function seedAnimatedAssets(admin: SupabaseClient, supabaseUrl: string) {
  const gif = animatedGif(DEMO_GIF.size, DISC_PALETTE, bouncingDisc(DEMO_GIF.size), 300);
  const options = { contentType: "image/gif", upsert: true };

  const attachment = await admin.storage.from(SLACK_FILES_BUCKET).upload(DEMO_GIF_PATH, gif, options);
  if (attachment.error) throw new Error(`slack-files upload: ${attachment.error.message}`);

  const created = await admin.storage.createBucket(EMOJI_BUCKET, { public: true });
  if (created.error && !/already exists/i.test(created.error.message)) throw new Error(`${EMOJI_BUCKET} bucket: ${created.error.message}`);
  const emoji = await admin.storage.from(EMOJI_BUCKET).upload(`${DEMO_ANIMATED_EMOJI}.gif`, gif, options);
  if (emoji.error) throw new Error(`${EMOJI_BUCKET} upload: ${emoji.error.message}`);

  const { error } = await admin
    .schema("bronze")
    .from("slack_custom_emoji")
    .upsert({ name: DEMO_ANIMATED_EMOJI, image_url: `${supabaseUrl}/storage/v1/object/public/${EMOJI_BUCKET}/${DEMO_ANIMATED_EMOJI}.gif`, deleted_at: null }, { onConflict: "name" });
  if (error) throw new Error(`slack_custom_emoji: ${error.message}`);
}

/** Turn the chat features on and write the channels, their members, messages, threads and reactions. Replaced on every run. */
export async function seedChat(admin: SupabaseClient, now: Date, supabaseUrl: string) {
  await seedAnimatedAssets(admin, supabaseUrl);

  const { error: flagError } = await admin
    .from("feature_flags")
    .upsert([{ feature_key: "chat", enabled_globally: true }, { feature_key: "chat_posting", enabled_globally: true }], { onConflict: "feature_key" });
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

  // Replaced on every run: only the demo's own channels (named in DEMO_CHANNELS, with no Slack id or a demo one).
  const { error: wipeError } = await admin
    .from("chat_channels")
    .delete()
    .in("name", DEMO_CHANNELS.map((c) => c.name))
    .or(`slack_channel_id.is.null,slack_channel_id.like.${DEMO_SLACK_PREFIX}%`);
  if (wipeError) throw new Error(`chat_channels clear: ${wipeError.message}`);

  const demoMember = id(who("member"));
  const everyone = [...byName.values()];

  // Posting needs the member to have connected Slack. The demo has no Slack, so this is a connection record with no
  // tokens: enough for the Hub to treat the member as connected. The message isn't sent anywhere (outside production
  // the app leaves a post saved and pending), and the recording plays Slack's part by marking it sent (slack-stand-in.ts).
  const { error: connectionError } = await admin
    .from("member_slack_connections")
    .upsert({ member_id: demoMember, slack_user_id: `${DEMO_SLACK_PREFIX.replace("C", "U")}USER01`, scopes: [], revoked_at: null }, { onConflict: "member_id" });
  if (connectionError) throw new Error(`member_slack_connections: ${connectionError.message}`);

  let slackSeq = 0;
  const slackTs = (iso: string) => `${Math.floor(Date.parse(iso) / 1000)}.${String(++slackSeq).padStart(6, "0")}`;

  for (const [index, channel] of DEMO_CHANNELS.entries()) {
    const { data: created, error: channelError } = await admin
      .from("chat_channels")
      .insert({
        kind: "channel",
        bridge_mode: "bridged",
        slack_channel_id: `${DEMO_SLACK_PREFIX}${String(index + 1).padStart(6, "0")}`,
        visibility: "public",
        name: channel.name,
        topic: channel.topic,
        created_at: at(24 * 30),
      })
      .select("id")
      .single();
    if (channelError || !created) throw new Error(`chat_channels ${channel.name}: ${channelError?.message}`);

    const { error: memberError } = await admin.from("chat_channel_members").insert(
      everyone.map((member_id) => ({
        channel_id: created.id,
        member_id,
        source: "slack",
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
          origin: "slack",
          slack_ts: slackTs(at(message.hoursAgo)),
          created_at: at(message.hoursAgo),
          reply_count: replies.length,
          last_reply_at: lastReply ? at(message.hoursAgo, lastReply.minutesAfter) : null,
        })
        .select("id, slack_ts")
        .single();
      if (rootError || !root) throw new Error(`chat_messages ${channel.name}: ${rootError?.message}`);
      const contents: { message_id: string; body: string; files?: unknown }[] = [{ message_id: root.id, body: message.body }];
      if (message.gif) {
        const channelSlackId = `${DEMO_SLACK_PREFIX}${String(index + 1).padStart(6, "0")}`;
        const { error: fileError } = await admin
          .schema("bronze")
          .from("slack_files")
          .upsert(
            { file_id: DEMO_GIF.id, channel_id: channelSlackId, message_ts: root.slack_ts as string, name: DEMO_GIF.name, mimetype: "image/gif", storage_path: DEMO_GIF_PATH, raw_payload: {}, deleted_at: null },
            { onConflict: "file_id" },
          );
        if (fileError) throw new Error(`slack_files: ${fileError.message}`);
        contents[0].files = [{ id: DEMO_GIF.id, name: DEMO_GIF.name, mimetype: "image/gif", size: null, width: DEMO_GIF.size, height: DEMO_GIF.size }];
        const { error: flagFiles } = await admin.from("chat_messages").update({ has_files: true }).eq("id", root.id);
        if (flagFiles) throw new Error(`chat_messages has_files: ${flagFiles.message}`);
      }

      for (const reply of replies) {
        const { data: row, error: replyError } = await admin
          .from("chat_messages")
          .insert({
            channel_id: created.id,
            author_member_id: id(reply.by),
            thread_root_id: root.id,
            origin: "slack",
            slack_ts: slackTs(at(message.hoursAgo, reply.minutesAfter)),
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
