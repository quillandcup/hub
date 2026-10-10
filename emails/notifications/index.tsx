import * as React from "react";
import { render } from "react-email";
import type { NotificationKindId } from "@/lib/notifications/registry";
import type { NotificationEmailProps } from "./NotificationEmail";
import { PrickleCheckinEmail } from "./prickle-checkin";
import { PrickleCheckoutEmail } from "./prickle-checkout";

/**
 * One template per notification kind, as React Email components. Member notification emails are
 * rendered when they're sent (renderNotificationEmail, below) rather than ahead of time and pushed
 * to Supabase: Supabase's email templates are only for its own auth emails (sign-in links, invites;
 * supabase/emails/ -> supabase/templates/, pushed with the config), and its mailer can't send
 * anything else. Both share the layout in supabase/emails/layout.tsx.
 *
 * Adding a kind to lib/notifications/registry.ts needs a template here; TypeScript enforces it.
 */
const TEMPLATES = {
  prickle_checkin: PrickleCheckinEmail,
  prickle_checkout: PrickleCheckoutEmail,
} satisfies Record<NotificationKindId, (props: NotificationEmailProps) => React.ReactElement>;

export interface RenderedNotificationEmail {
  subject: string;
  html: string;
  text: string;
}

export async function renderNotificationEmail(
  kind: NotificationKindId,
  props: NotificationEmailProps
): Promise<RenderedNotificationEmail> {
  const element = React.createElement(TEMPLATES[kind], props);
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { subject: props.text, html, text };
}
