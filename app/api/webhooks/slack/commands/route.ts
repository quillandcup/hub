import { NextRequest, NextResponse } from "next/server";
import { verifySlackSignature } from "@/lib/slack-signature";
import { prepareSlackSignIn } from "@/lib/slack-sign-in";
import { createServiceRoleClient } from "@/lib/supabase/service";

// Slack wants a reply within 3 seconds
export const maxDuration = 10;

/**
 * Slack slash commands. Currently just `/hub`: replies ephemerally (only the person who ran it
 * sees it) with their one-time "Open Hedgie Hub" sign-in button -- see lib/slack-sign-in.ts.
 * Slash command payloads are application/x-www-form-urlencoded, so this is its own endpoint
 * (like interactions/). Requires the command in slack-app-manifest.yml to point here.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  const signature = request.headers.get("x-slack-signature");
  const timestamp = request.headers.get("x-slack-request-timestamp");
  const sigResult = verifySlackSignature(rawBody, signature, timestamp, process.env.SLACK_SIGNING_SECRET);
  if (!sigResult.valid) {
    console.error("Invalid or missing Slack slash command signature:", sigResult.reason);
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const params = new URLSearchParams(rawBody);
  const command = params.get("command");
  const slackUserId = params.get("user_id");

  if (command !== "/hub" || !slackUserId) {
    return NextResponse.json({ response_type: "ephemeral", text: "Sorry, I don't know that command." });
  }

  try {
    const prepared = await prepareSlackSignIn(createServiceRoleClient(), slackUserId, new URL(request.url).origin, {
      withRefresh: false,
    });
    if (!prepared) {
      return NextResponse.json({ response_type: "ephemeral", text: "Slack sign-in isn't available right now." });
    }
    return NextResponse.json({ response_type: "ephemeral", text: prepared.text, blocks: prepared.blocks });
  } catch (error) {
    console.error("Error handling /hub for %s:", slackUserId, error);
    return NextResponse.json({
      response_type: "ephemeral",
      text: "Something went wrong making your sign-in link. Please try again in a moment.",
    });
  }
}
