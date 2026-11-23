import type { NextRequest } from "next/server";
import { handleSlackWebhook, handleSlackWebhookGet } from "@/modules/chat/slack/webhook";

// Webhook should respond quickly
export const maxDuration = 60;

/**
 * Slack Events API webhook. The route file stays where Next needs it and is thin: the handling is the Slack adapter's
 * (src/modules/chat/slack/webhook.ts), which asks chat core what to do with each message, edit, deletion and reaction.
 */
export const POST = (request: NextRequest) => handleSlackWebhook(request);

export const GET = (request: NextRequest) => handleSlackWebhookGet(request);
