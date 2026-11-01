import { createRepos } from "@/lib/data/repos";
import { requireAdmin } from "@/lib/supabase/api-auth";
import { buildReverseAliasMap, getMemberEmails } from "@/lib/stripe-matching";
import { NextRequest, NextResponse } from "next/server";

export interface MemberExternalStatus {
  kajabi_id: string | null;
  kajabi_active_purchases: number;
  stripe_customer_id: string | null;
  stripe_active_subscriptions: number;
  slack_user_id: string | null;
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  const ids = (new URL(request.url).searchParams.get("ids") ?? "")
    .split(",")
    .filter(Boolean);
  if (ids.length === 0) return NextResponse.json({ members: {} });

  const [members, emailAliases] = await Promise.all([
    createRepos(supabase).members.byIds(ids),
    createRepos(supabase).aliases.emailAliases(),
  ]);

  if (members.length === 0) return NextResponse.json({ members: {} });

  // Per-member full email sets (canonical + all aliases pointing to it)
  const reverseAliasMap = buildReverseAliasMap(emailAliases ?? []);
  const memberEmailSets = new Map<string, Set<string>>();
  for (const m of members) {
    memberEmailSets.set(m.email.toLowerCase(), getMemberEmails(m, reverseAliasMap));
  }

  const canonicalEmails = members.map(m => m.email.toLowerCase());
  const allEmails = Array.from(new Set([
    ...canonicalEmails,
    ...Array.from(memberEmailSets.values()).flatMap(s => Array.from(s)),
  ]));
  const stripeIds = members.map(m => m.stripeCustomerId).filter((v): v is string => !!v);

  const billing = createRepos(supabase).billing;
  const [
    kajabiCustomers,
    stripeActiveSubs,
    slackUsers,
  ] = await Promise.all([
    billing.kajabiCustomers({ emails: canonicalEmails }),
    billing.stripeSubscriptionStatuses(["active", "trialing", "past_due"], stripeIds),
    createRepos(supabase).slackUsers.byEmails(allEmails, { excludeBots: true }),
  ]);

  // Active Kajabi purchases for found customers
  const kajabiCustomerIds = kajabiCustomers.map(c => c.kajabi_customer_id);
  const activePurchaseCustomers = await billing.activeKajabiPurchaseCustomerIds(kajabiCustomerIds);

  const kajabiCustomerByEmail = new Map<string, string>();
  for (const c of kajabiCustomers) {
    kajabiCustomerByEmail.set(c.email.toLowerCase(), c.kajabi_customer_id);
  }

  const activeStripeCustomers = new Set(stripeActiveSubs.map(s => s.stripe_customer_id));

  const slackUserByEmail = new Map<string, string>();
  for (const u of slackUsers) {
    if (u.email) slackUserByEmail.set(u.email.toLowerCase(), u.user_id);
  }

  const result: Record<string, MemberExternalStatus> = {};
  for (const m of members) {
    const email = m.email.toLowerCase();
    const kajabiCustomerId = kajabiCustomerByEmail.get(email);
    const emailSet = memberEmailSets.get(email) ?? new Set([email]);
    const slackUserId = Array.from(emailSet).map(e => slackUserByEmail.get(e)).find(Boolean) ?? null;

    result[m.id] = {
      kajabi_id: m.kajabiId,
      kajabi_active_purchases: kajabiCustomerId && activePurchaseCustomers.has(kajabiCustomerId) ? 1 : 0,
      stripe_customer_id: m.stripeCustomerId,
      stripe_active_subscriptions: m.stripeCustomerId && activeStripeCustomers.has(m.stripeCustomerId) ? 1 : 0,
      slack_user_id: slackUserId ?? null,
    };
  }

  return NextResponse.json({ members: result });
}
