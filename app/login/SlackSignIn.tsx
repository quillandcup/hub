/**
 * Sign in through the Hedgie Hub Slack app instead of waiting for an email. "Open Hedgie Hub in
 * Slack" deep-links to the app's Home tab (desktop and mobile), whose button signs in with one
 * click. For a browser other than the one Slack opens links in (Safari on iPhone, where Slack's
 * in-app browser keeps its own cookies), the link or code from Slack goes into the sign-in code box
 * (./CodeEntry.tsx).
 */
export default function SlackSignIn({ slackHomeUrl }: { slackHomeUrl: string }) {
  return (
    <div className="space-y-3">
      <a
        href={slackHomeUrl}
        className="flex w-full items-center justify-center px-6 py-3 border border-plum-600 text-plum-700 dark:text-plum-300 font-semibold rounded-lg transition-colors hover:bg-plum-50 dark:hover:bg-slate-800"
      >
        Open Hedgie Hub in Slack
      </a>
      <p className="text-sm text-slate-600 dark:text-slate-400 text-center">
        Then tap <strong>Open Hedgie Hub</strong> in the app&apos;s Home tab.
      </p>
    </div>
  );
}
