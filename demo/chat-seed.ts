import { DEMO_COURSE_SOURCE_PREFIX, DEMO_SHARED_LESSON } from "./courses-seed";
import type { SupabaseClient } from "@supabase/supabase-js";
import { COMMUNITY } from "@/lib/data/profiles/community";
import { storeEmojiImage } from "@/lib/chat/emoji-copy";
import { SLACK_EMOJI_BUCKET } from "@/lib/chat/emoji-url";
import { SLACK_FILES_BUCKET } from "@/lib/slack-capture";
import { SLACK_USER_SCOPES } from "@/lib/slack-connect";
import { animatedGif, bouncingDisc, DISC_PALETTE } from "./gif";

/**
 * The demo community's chat: four channels with a few days of friendly, fictional conversation, threads and
 * reactions, and a few messages the demo member hasn't read yet (so the sidebar shows unread counts). Written
 * straight into the chat tables (Local layer) as bridged channels with made-up Slack ids; production mirrors Slack
 * into the same tables (docs/SLACK_BRIDGED_CHAT.md). Chat is open to every member, and the demo member has a (token-less) Slack connection, so the composer works: a post is saved as the
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
/** The craft-talk message that shares a lesson's video; `seedChatVideoShare` finds it by this text once the courses exist. */
export const DEMO_SHARED_VIDEO_MESSAGE = "this lesson made the toast thing click for me 🍞 watch it right here";

const DEMO_GIF = { id: "FDEMO0000001", name: "party-disc.gif", size: 160 };

interface DemoMessage {
  by: string;
  hoursAgo: number;
  body: string;
  /** Attach the demo's animated GIF. */
  gif?: boolean;
  reactions?: { emoji: string; by: string[] }[];
  replies?: DemoReply[];
  /** The preview card the Hub would have stored for the link in `body` (the demo can't run the fetch the server does after a send). */
  linkPreview?: { url: string; title: string; description: string; siteName: string; imageUrl: string };
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
      {
        by: who("willa"),
        hoursAgo: 2,
        body: DEMO_SHARED_VIDEO_MESSAGE,
        reactions: [{ emoji: "bread", by: [who("briony")] }],
      },
      {
        by: who("member"),
        hoursAgo: 4,
        body: "research for my lighthouse bakery: this is the keeper's cottage I keep picturing 🏠 https://lighthouse-keepers.example.com/bass-harbor-cottage",
        linkPreview: {
          url: "https://lighthouse-keepers.example.com/bass-harbor-cottage",
          title: "Life at the Light: a keeper's cottage on the Maine coast",
          description: "Photographs and a few diary pages from a family who tended a harbor light, with the bread they baked every morning.",
          siteName: "Lighthouse Keepers' Notebook",
          imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/52/Bass_Harbor_Head_Lighthouse%2C_NOAA%2C_2003.jpg/960px-Bass_Harbor_Head_Lighthouse%2C_NOAA%2C_2003.jpg",
        },
      },
      {
        by: who("host"),
        hoursAgo: 3,
        body: "my revision trick: search the draft for `suddenly` and `very`, then cut them. a bigger one is to paste the opening line here:\n```\nIt was a dark and stormy night.\n```\nand ask what the reader wants to know next",
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

interface DemoConversation {
  kind: "dm" | "group_dm";
  /** The other members besides the demo member (community profile keys). */
  with: string[];
  readHoursAgo: number;
  messages: { by: string; hoursAgo: number; body: string; reactions?: { emoji: string; by: string[] }[] }[];
}

/** The demo member's direct messages and group message, as the Slack bridge brings them in (private, restricted, unnamed; the sidebar labels them with the people in them). */
export const DEMO_CONVERSATIONS: DemoConversation[] = [
  {
    kind: "dm",
    with: ["regular2"],
    readHoursAgo: 30,
    messages: [
      { by: "regular2", hoursAgo: 28, body: "psst, are you still up for swapping chapter one critiques this weekend? 📓" },
      { by: "member", hoursAgo: 27, body: "yes please! I'll send mine tonight, fair warning: there is a lot of tea in it 🍵" },
      { by: "regular2", hoursAgo: 3, body: "read it on the train. the lighthouse bakery is a delight 🥐 notes coming tomorrow", reactions: [{ emoji: "heart", by: ["member"] }] },
    ],
  },
  {
    kind: "dm",
    with: ["host"],
    readHoursAgo: 0,
    messages: [
      { by: "host", hoursAgo: 50, body: "so glad you joined the Sprint Prickle last night! 🌙" },
      { by: "member", hoursAgo: 49, body: "it was great, 600 words in an hour. thank you for hosting 💛" },
    ],
  },
  {
    kind: "group_dm",
    with: ["willa", "briony"],
    readHoursAgo: 12,
    messages: [
      { by: "willa", hoursAgo: 14, body: "group chat for the Thursday read-aloud swap? 🎧" },
      { by: "briony", hoursAgo: 13, body: "yes! I'll bring the first scene of my space-station mystery 🚀", reactions: [{ emoji: "tada", by: ["willa", "member"] }] },
      { by: "member", hoursAgo: 12, body: "in. I'll read my lighthouse bakery opening, bring snacks 🧁" },
      { by: "willa", hoursAgo: 1, body: "see you at 8, I'll make the call link ✨" },
    ],
  },
];

const DEMO_GIF_PATH = "demo/party-disc.gif";

/**
 * The two animated images: the attachment goes in the private slack-files bucket where the chat's file route
 * reads it (its `slack_files` row says it is already copied, so no Slack is needed), and the emoji as the sync
 * stores one: in the public emoji bucket with a still of its first frame.
 */
async function seedAnimatedAssets(admin: SupabaseClient, supabaseUrl: string) {
  const gif = animatedGif(DEMO_GIF.size, DISC_PALETTE, bouncingDisc(DEMO_GIF.size), 300);
  const options = { contentType: "image/gif", upsert: true };

  const attachment = await admin.storage.from(SLACK_FILES_BUCKET).upload(DEMO_GIF_PATH, gif, options);
  if (attachment.error) throw new Error(`slack-files upload: ${attachment.error.message}`);

  // The same path a synced emoji takes: our copy in the emoji bucket, with a still of the first frame.
  const { imagePath, stillPath } = await storeEmojiImage(admin, gif);
  const url = `${supabaseUrl}/storage/v1/object/public/${SLACK_EMOJI_BUCKET}`;
  const { error } = await admin
    .schema("bronze")
    .from("slack_custom_emoji")
    .upsert(
      { name: DEMO_ANIMATED_EMOJI, image_url: `${url}/${imagePath}`, image_path: imagePath, still_path: stillPath, copied_from_url: `${url}/${imagePath}`, deleted_at: null },
      { onConflict: "name" }
    );
  if (error) throw new Error(`slack_custom_emoji: ${error.message}`);
}

/** Write the channels, their members, messages, threads and reactions. Replaced on every run. */
export async function seedChat(admin: SupabaseClient, now: Date, supabaseUrl: string) {
  await seedAnimatedAssets(admin, supabaseUrl);

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
  // Full scopes, so no "reconnect Slack" bar covers the page. The newcomer is the one signed-in persona without a connection:
  // the Getting started tour's Connect Slack step is open for them (demo/member-content-seed.ts).
  const connected = COMMUNITY.people.filter((p) => p.signsIn && p.key !== "newcomer" && byName.has(p.name));
  const { error: connectionError } = await admin.from("member_slack_connections").upsert(
    connected.map((p, i) => ({ member_id: id(p.name), slack_user_id: `${DEMO_SLACK_PREFIX.replace("C", "U")}USER${String(i + 1).padStart(2, "0")}`, scopes: [...SLACK_USER_SCOPES], revoked_at: null })),
    { onConflict: "member_id" },
  );
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

      if (message.linkPreview) {
        const preview = message.linkPreview;
        const { error: previewError } = await admin.from("chat_link_previews").insert({
          message_id: root.id,
          position: 0,
          url: preview.url,
          final_url: preview.url,
          kind: "link",
          status: "ok",
          title: preview.title,
          description: preview.description,
          site_name: preview.siteName,
          image_url: preview.imageUrl,
        });
        if (previewError) throw new Error(`chat_link_previews: ${previewError.message}`);
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

  await seedConversations(admin, now, id, demoMember);
}

/** The demo member's direct messages and group message: restricted conversations with a Slack id of their own, so a re-run replaces them. */
async function seedConversations(admin: SupabaseClient, now: Date, id: (name: string) => string, demoMember: string) {
  const at = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * 3_600_000).toISOString();
  const { error: wipeError } = await admin.from("chat_channels").delete().in("kind", ["dm", "group_dm"]).like("slack_channel_id", `${DEMO_SLACK_PREFIX}%`);
  if (wipeError) throw new Error(`chat conversations clear: ${wipeError.message}`);
  const key = (k: string) => (k === "member" ? demoMember : id(who(k)));
  let seq = 0;
  for (const [index, convo] of DEMO_CONVERSATIONS.entries()) {
    const { data: created, error } = await admin
      .from("chat_channels")
      .insert({
        kind: convo.kind,
        bridge_mode: "bridged",
        slack_channel_id: `${DEMO_SLACK_PREFIX}${convo.kind === "dm" ? "D" : "G"}${String(index + 1).padStart(5, "0")}`,
        visibility: "private",
        restricted: true,
        created_at: at(24 * 30),
      })
      .select("id")
      .single();
    if (error || !created) throw new Error(`chat_channels ${convo.kind}: ${error?.message}`);
    const people = [demoMember, ...convo.with.map(key)];
    const { error: memberError } = await admin.from("chat_channel_members").insert(
      people.map((member_id) => ({ channel_id: created.id, member_id, source: "slack", joined_at: at(24 * 30), last_read_at: member_id === demoMember ? at(convo.readHoursAgo) : at(0) })),
    );
    if (memberError) throw new Error(`chat_channel_members ${convo.kind}: ${memberError.message}`);
    for (const message of convo.messages) {
      const { data: row, error: messageError } = await admin
        .from("chat_messages")
        .insert({ channel_id: created.id, author_member_id: key(message.by), origin: "slack", slack_ts: `${Math.floor(Date.parse(at(message.hoursAgo)) / 1000)}.${String(900000 + ++seq)}`, created_at: at(message.hoursAgo) })
        .select("id")
        .single();
      if (messageError || !row) throw new Error(`chat_messages ${convo.kind}: ${messageError?.message}`);
      const { error: contentError } = await admin.from("chat_message_contents").insert({ message_id: row.id, body: message.body });
      if (contentError) throw new Error(`chat_message_contents ${convo.kind}: ${contentError.message}`);
      const reactions = (message.reactions ?? []).flatMap((r) => r.by.map((by) => ({ message_id: row.id, channel_id: created.id, member_id: key(by), emoji: r.emoji, created_at: at(message.hoursAgo) })));
      if (reactions.length > 0) {
        const { error: reactionError } = await admin.from("chat_reactions").insert(reactions);
        if (reactionError) throw new Error(`chat_reactions ${convo.kind}: ${reactionError.message}`);
      }
    }
  }
}

/**
 * Makes the craft-talk message above share the demo course's ready lesson video (`DEMO_SHARED_LESSON`), open to the channel
 * so everyone in the conversation can see the card. Runs after the courses are seeded (the lesson must exist), and again on every seed.
 */
export async function seedChatVideoShare(admin: SupabaseClient) {
  const { data: message, error: messageError } = await admin.from("chat_message_contents").select("message_id").eq("body", DEMO_SHARED_VIDEO_MESSAGE).maybeSingle();
  if (messageError) throw new Error(`chat_message_contents: ${messageError.message}`);
  const { data: lesson, error: lessonError } = await admin
    .from("course_lessons")
    .select("id")
    .eq("source_key", `${DEMO_COURSE_SOURCE_PREFIX}${DEMO_SHARED_LESSON.courseKey}-${DEMO_SHARED_LESSON.lessonKey}`)
    .maybeSingle();
  if (lessonError) throw new Error(`course_lessons: ${lessonError.message}`);
  if (!message || !lesson) throw new Error("chat video share: the demo message or lesson is missing");
  const { error } = await admin.from("chat_message_videos").upsert({ message_id: message.message_id, lesson_id: lesson.id, open_to_channel: false }, { onConflict: "message_id" });
  if (error) throw new Error(`chat_message_videos: ${error.message}`);
}
