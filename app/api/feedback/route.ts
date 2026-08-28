import { NextRequest, NextResponse, after } from "next/server";
import { randomUUID } from "crypto";
import { WebClient } from "@slack/web-api";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveIdentity, type EffectiveIdentity } from "@/lib/sudo";
import { withTimeout, AUTH_CHECK_TIMEOUT_MS } from "@/lib/with-timeout";

const FEEDBACK_TYPES = ["bug", "data", "idea"] as const;
type FeedbackType = (typeof FEEDBACK_TYPES)[number];

const TYPE_LABELS: Record<FeedbackType, string> = {
  bug: "🐛 Bug",
  data: "📊 Data issue",
  idea: "💡 Idea",
};

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  let user;
  try {
    const { data } = await withTimeout(supabase.auth.getUser(), AUTH_CHECK_TIMEOUT_MS);
    user = data.user;
  } catch {
    return NextResponse.json({ error: "Auth check timed out, try again" }, { status: 503 });
  }
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await request.formData();
  const message = (formData.get("message") as string | null)?.trim();
  const feedbackType = formData.get("feedback_type") as string | null;
  const pageUrl = formData.get("page_url") as string | null;
  const userAgent = formData.get("user_agent") as string | null;
  const screenshot = formData.get("screenshot") as File | null;

  if (
    !message ||
    !pageUrl ||
    !feedbackType ||
    !FEEDBACK_TYPES.includes(feedbackType as FeedbackType)
  ) {
    return NextResponse.json({ error: "Invalid feedback submission" }, { status: 400 });
  }

  // Admins with no member record resolve to null here — that's fine, the
  // feedback is still attributed to them via user_id.
  const effectiveIdentity = await getEffectiveIdentity(user).catch(() => null);

  const id = randomUUID();
  let screenshotPath: string | null = null;
  let screenshotBuffer: Buffer | null = null;

  if (screenshot && screenshot.size > 0) {
    screenshotBuffer = Buffer.from(await screenshot.arrayBuffer());
    const path = `${user.id}/${id}.png`;
    const { error: uploadError } = await supabase.storage
      .from("feedback-screenshots")
      .upload(path, screenshotBuffer, { contentType: "image/png" });
    if (!uploadError) {
      screenshotPath = path;
    } else {
      console.error("Feedback screenshot upload failed:", uploadError);
      screenshotBuffer = null;
    }
  }

  const { data: row, error: insertError } = await supabase
    .from("feedback")
    .insert({
      id,
      user_id: user.id,
      member_id: effectiveIdentity?.memberId ?? null,
      is_sudo: effectiveIdentity?.isSudo ?? false,
      page_url: pageUrl,
      feedback_type: feedbackType,
      message,
      screenshot_path: screenshotPath,
      user_agent: userAgent,
    })
    .select()
    .single();

  if (insertError || !row) {
    console.error("Feedback insert failed:", insertError);
    return NextResponse.json({ error: "Failed to save feedback" }, { status: 500 });
  }

  // Runs after the response is sent, but keeps the function instance alive
  // until it settles — a plain unawaited call risks the instance freezing
  // mid-request on Vercel, silently dropping the Slack notification.
  after(() =>
    notifySlack({
      buffer: screenshotBuffer,
      message,
      feedbackType: feedbackType as FeedbackType,
      pageUrl,
      user,
      effectiveIdentity,
    }).catch((err) => console.error("Feedback Slack notification failed:", err))
  );

  return NextResponse.json({ id: row.id, screenshotCaptured: !!screenshotPath });
}

async function notifySlack(params: {
  buffer: Buffer | null;
  message: string;
  feedbackType: FeedbackType;
  pageUrl: string;
  user: { id: string; email?: string | null };
  effectiveIdentity: EffectiveIdentity | null;
}) {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_FEEDBACK_CHANNEL_ID;
  if (!token || !channel) return;

  const { buffer, message, feedbackType, pageUrl, user, effectiveIdentity } = params;

  const submitter = effectiveIdentity
    ? effectiveIdentity.isSudo
      ? `${effectiveIdentity.memberName} (sudo'd by ${user.email})`
      : effectiveIdentity.memberName
    : user.email ?? user.id;

  const text = `*${TYPE_LABELS[feedbackType]}* from ${submitter}\n${message}\n<${pageUrl}|View page>`;

  const slack = new WebClient(token);
  if (buffer) {
    await slack.filesUploadV2({
      channel_id: channel,
      initial_comment: text,
      file: buffer,
      filename: "screenshot.png",
    });
  } else {
    await slack.chat.postMessage({ channel, text: `${text}\n_(no screenshot captured)_` });
  }
}
