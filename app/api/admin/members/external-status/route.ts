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

  const [{ data: members }, { data: emailAliases }] = await Promise.all([
    supabase.from("members").select("id, email, kajabi_id, stripe_customer_id").in("id", ids),
    supabase.from("member_email_aliases").select("alias_email, canonical_email"),
  ]);

  if (!members?.length) return NextResponse.json({ members: {} });

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
  const stripeIds = members.map(m => m.stripe_customer_id).filter((v): v is string => !!v);

  const [
    { data: kajabiCustomers },
    { data: stripeActiveSubs },
    { data: slackUsers },
  ] = await Promise.all([
    supabase.schema("bronze").from("kajabi_customers")
      .select("kajabi_customer_id, email")
      .in("email", canonicalEmails),
    stripeIds.length > 0
      ? supabase.schema("bronze").from("stripe_subscriptions")
          .select("stripe_customer_id")
          .in("stripe_customer_id", stripeIds)
          .in("status", ["active", "trialing", "past_due"])
      : Promise.resolve({ data: [] as { stripe_customer_id: string }[] }),
    supabase.schema("bronze").from("slack_users")
      .select("user_id, email")
      .in("email", allEmails)
      .eq("is_bot", false),
  ]);

  // Active Kajabi purchases for found customers
  const kajabiCustomerIds = (kajabiCustomers ?? []).map(c => c.kajabi_customer_id);
  const { data: kajabiActivePurchases } = kajabiCustomerIds.length > 0
    ? await supabase.schema("bronze").from("kajabi_purchases")
        .select("kajabi_customer_id")
        .in("kajabi_customer_id", kajabiCustomerIds)
        .eq("status", "active")
    : { data: [] as { kajabi_customer_id: string }[] };

  const kajabiCustomerByEmail = new Map<string, string>();
  for (const c of kajabiCustomers ?? []) {
    kajabiCustomerByEmail.set(c.email.toLowerCase(), c.kajabi_customer_id);
  }

  const activePurchaseCustomers = new Set((kajabiActivePurchases ?? []).map(p => p.kajabi_customer_id));
  const activeStripeCustomers = new Set((stripeActiveSubs ?? []).map(s => s.stripe_customer_id));

  const slackUserByEmail = new Map<string, string>();
  for (const u of slackUsers ?? []) {
    if (u.email) slackUserByEmail.set(u.email.toLowerCase(), u.user_id);
  }

  const result: Record<string, MemberExternalStatus> = {};
  for (const m of members) {
    const email = m.email.toLowerCase();
    const kajabiCustomerId = kajabiCustomerByEmail.get(email);
    const emailSet = memberEmailSets.get(email) ?? new Set([email]);
    const slackUserId = Array.from(emailSet).map(e => slackUserByEmail.get(e)).find(Boolean) ?? null;

    result[m.id] = {
      kajabi_id: m.kajabi_id,
      kajabi_active_purchases: kajabiCustomerId && activePurchaseCustomers.has(kajabiCustomerId) ? 1 : 0,
      stripe_customer_id: m.stripe_customer_id,
      stripe_active_subscriptions: m.stripe_customer_id && activeStripeCustomers.has(m.stripe_customer_id) ? 1 : 0,
      slack_user_id: slackUserId ?? null,
    };
  }

  return NextResponse.json({ members: result });
}
