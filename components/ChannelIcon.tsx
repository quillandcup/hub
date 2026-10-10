import type { ChannelId } from "@/lib/channels/catalog";

/**
 * A delivery channel's logo (lib/channels/catalog.ts), for compact per-row toggles. Decorative:
 * callers label the control. Every channel in CHANNELS needs an entry here (TypeScript enforces it).
 */
const ICONS: Record<ChannelId, (props: { className?: string }) => React.ReactElement> = {
  slack: ({ className }) => (
    <svg viewBox="0 0 122.8 122.8" className={className} aria-hidden="true" focusable="false">
      <path
        fill="#e01e5a"
        d="M25.8 77.6c0 7.1-5.8 12.9-12.9 12.9S0 84.7 0 77.6s5.8-12.9 12.9-12.9h12.9v12.9zm6.5 0c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9v32.3c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V77.6z"
      />
      <path
        fill="#36c5f0"
        d="M45.2 25.8c-7.1 0-12.9-5.8-12.9-12.9S38.1 0 45.2 0s12.9 5.8 12.9 12.9v12.9H45.2zm0 6.5c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H12.9C5.8 58.1 0 52.3 0 45.2s5.8-12.9 12.9-12.9h32.3z"
      />
      <path
        fill="#2eb67d"
        d="M97 45.2c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9-5.8 12.9-12.9 12.9H97V45.2zm-6.5 0c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V12.9C64.7 5.8 70.5 0 77.6 0s12.9 5.8 12.9 12.9v32.3z"
      />
      <path
        fill="#ecb22e"
        d="M77.6 97c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9-12.9-5.8-12.9-12.9V97h12.9zm0-6.5c-7.1 0-12.9-5.8-12.9-12.9s5.8-12.9 12.9-12.9h32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H77.6z"
      />
    </svg>
  ),
  in_app: ({ className }) => (
    // A bell, in the Hub's plum.
    <svg
      viewBox="0 0 24 24"
      className={`text-plum-600 dark:text-plum-400 ${className ?? ""}`}
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M12 2a1 1 0 0 1 1 1v.6A6 6 0 0 1 18 9.5v3.8l1.7 2.6a1 1 0 0 1-.8 1.6H5.1a1 1 0 0 1-.8-1.6L6 13.3V9.5a6 6 0 0 1 5-5.9V3a1 1 0 0 1 1-1zm-2.4 17h4.8a2.4 2.4 0 0 1-4.8 0z"
      />
    </svg>
  ),
  email: ({ className }) => (
    // An envelope, in slate so it reads next to the colored Slack and bell logos.
    <svg
      viewBox="0 0 24 24"
      className={`text-slate-600 dark:text-slate-300 ${className ?? ""}`}
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 2v.5l8 5 8-5V6H4zm16 3-7.5 4.7a1 1 0 0 1-1 0L4 9v9h16V9z"
      />
    </svg>
  ),
};

export function ChannelIcon({ channel, className }: { channel: ChannelId; className?: string }) {
  const Icon = ICONS[channel];
  return <Icon className={className} />;
}
