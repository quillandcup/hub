import { APP_URL, JOIN_URL, KAJABI_LOGIN_URL } from "@/lib/config";

/**
 * The public homepage on the root host (quillandcup.com), seen by everyone: nobody is signed in on that host (the session
 * belongs to the app host), so "Member login" goes to the Hub login. Plain on purpose; the owner fills in the real content
 * later. The "Join" link is `joinUrl` in config/app.ts (not decided yet).
 */
export default function RootHomepage() {
  const button = "inline-block rounded-lg px-6 py-3 font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-plum-500 focus-visible:ring-offset-2";
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-6 dark:bg-slate-950">
      <div className="w-full max-w-xl text-center">
        <h1 className="mb-3 text-4xl font-bold text-plum-700 dark:text-plum-300">Quill &amp; Cup</h1>
        <p className="mb-8 text-lg text-slate-700 dark:text-slate-300">A community of writers who show up, write together and finish their books.</p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <a href={JOIN_URL} data-track="home-join" className={`${button} bg-plum-700 text-white hover:bg-plum-800`}>
            Join
          </a>
          <a
            href={`${APP_URL}/login`}
            data-track="home-member-login"
            className={`${button} border border-plum-700 text-plum-800 hover:bg-plum-50 dark:border-plum-300 dark:text-plum-200 dark:hover:bg-slate-900`}
          >
            Member login
          </a>
        </div>
        <p className="mt-8 text-sm text-slate-600 dark:text-slate-400">
          Still on Kajabi?{" "}
          <a href={KAJABI_LOGIN_URL} data-track="home-kajabi-login" className="font-medium text-plum-700 underline underline-offset-2 hover:text-plum-800 dark:text-plum-300 dark:hover:text-plum-200">
            Sign in there
          </a>
          .
        </p>
      </div>
    </main>
  );
}
