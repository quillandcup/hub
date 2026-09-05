import type { MemberExternalStatus } from "@/app/api/admin/members/external-status/route";

interface MemberLite {
  name: string;
  email: string;
}

export function hasExternalNotes(status: MemberExternalStatus | undefined | null): boolean {
  if (!status) return false;
  return !!(status.kajabi_id || status.stripe_customer_id || status.slack_user_id);
}

// A field "conflicts" when both members have a different non-null value for it —
// merging keeps the primary's and silently discards the secondary's. That's only
// worth calling out if the discarded value is actually live (an active
// subscription/purchase), not just a stale ID sitting on an old record.
function stripeConflicts(primary: MemberExternalStatus | undefined, secondary: MemberExternalStatus): boolean {
  return !!(
    primary?.stripe_customer_id &&
    secondary.stripe_customer_id &&
    primary.stripe_customer_id !== secondary.stripe_customer_id &&
    secondary.stripe_active_subscriptions > 0
  );
}

function kajabiConflicts(primary: MemberExternalStatus | undefined, secondary: MemberExternalStatus): boolean {
  return !!(
    primary?.kajabi_id &&
    secondary.kajabi_id &&
    primary.kajabi_id !== secondary.kajabi_id &&
    secondary.kajabi_active_purchases > 0
  );
}

// Whether merging this secondary in requires the admin to actually do
// something first (a live subscription would otherwise be silently discarded).
// Everything else here is either automatic (aliases, ID transfer) or a
// heads-up about a separate system Hub has no write access to.
export function needsActionBeforeMerge(
  primary: MemberExternalStatus | undefined,
  secondary: MemberExternalStatus
): boolean {
  return stripeConflicts(primary, secondary) || kajabiConflicts(primary, secondary);
}

export function MergeExternalNotice({
  primaryName,
  secondary,
  primaryStatus,
  secondaryStatus,
}: {
  primaryName: string;
  secondary: MemberLite;
  primaryStatus: MemberExternalStatus | undefined;
  secondaryStatus: MemberExternalStatus;
}) {
  const stripeConflict = stripeConflicts(primaryStatus, secondaryStatus);
  const kajabiConflict = kajabiConflicts(primaryStatus, secondaryStatus);

  return (
    <div>
      <p className="font-semibold mb-1">
        {secondary.name}{" "}
        <span className="font-normal text-slate-500 dark:text-slate-400">({secondary.email})</span>
      </p>
      <ul className="space-y-1 ml-2">
        {secondaryStatus.kajabi_id && (
          <li className="flex items-start gap-1.5">
            <span className="mt-0.5">•</span>
            <span className={kajabiConflict ? "text-red-700 dark:text-red-400 font-medium" : "text-slate-600 dark:text-slate-400"}>
              {kajabiConflict
                ? `Has its own active Kajabi subscription, different from ${primaryName}'s — merging keeps ${primaryName}'s and discards this one. Check both contacts in Kajabi.`
                : "Has a Kajabi contact — if it's a duplicate account, merge it separately in Kajabi (Hub can only merge its own records)."}
              {" "}
              <a
                href={`https://app.kajabi.com/admin/contacts/${secondaryStatus.kajabi_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 dark:text-blue-400 hover:underline"
              >
                {secondaryStatus.kajabi_id} ↗
              </a>
            </span>
          </li>
        )}
        {secondaryStatus.stripe_customer_id && (
          <li className="flex items-start gap-1.5">
            <span className="mt-0.5">•</span>
            <span className={stripeConflict ? "text-red-700 dark:text-red-400 font-medium" : "text-slate-600 dark:text-slate-400"}>
              {stripeConflict
                ? `Has its own active Stripe subscription, different from ${primaryName}'s — merging keeps ${primaryName}'s and discards this one. Decide which is correct in Stripe before merging.`
                : secondaryStatus.stripe_active_subscriptions > 0
                  ? `Active Stripe subscription — will transfer to ${primaryName} automatically.`
                  : "Stripe customer, no active subscription — will transfer automatically."}
              {" "}
              <a
                href={`https://dashboard.stripe.com/customers/${secondaryStatus.stripe_customer_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 dark:text-blue-400 hover:underline"
              >
                {secondaryStatus.stripe_customer_id} ↗
              </a>
            </span>
          </li>
        )}
        {secondaryStatus.slack_user_id && (
          <li className="flex items-start gap-1.5">
            <span className="mt-0.5">•</span>
            <span className="text-slate-600 dark:text-slate-400">
              Slack account ({secondaryStatus.slack_user_id}) — message history resolves automatically via email alias
            </span>
          </li>
        )}
      </ul>
    </div>
  );
}
