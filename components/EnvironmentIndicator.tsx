/**
 * Environment Indicator Component
 *
 * Displays a badge showing the current environment (Development/Preview/Production).
 * Only visible in non-production environments to help distinguish between environments.
 *
 * Usage:
 * Add to your root layout to show environment badge on all pages:
 *
 * ```tsx
 * import { EnvironmentIndicator } from '@/components/EnvironmentIndicator';
 *
 * export default function RootLayout({ children }) {
 *   return (
 *     <html>
 *       <body>
 *         <EnvironmentIndicator />
 *         {children}
 *       </body>
 *     </html>
 *   );
 * }
 * ```
 */

import { config } from '@/lib/config';

export function EnvironmentIndicator() {
  // Only show in non-production environments
  if (!config.features.showEnvironmentBadge) {
    return null;
  }

  const colorClass = config.getEnvironmentColor();
  const envName = config.getEnvironmentName();
  const branch = config.deployment.branch;
  const commitSha = config.deployment.commitSha?.slice(0, 7);

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <div
        className={`${colorClass} text-white px-3 py-2 rounded-lg shadow-lg text-sm font-medium`}
      >
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
          <div>
            <div className="font-bold">{envName}</div>
            {branch && (
              <div className="text-xs opacity-90">
                {branch}
                {commitSha && ` (${commitSha})`}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Minimal Environment Badge (for header/navbar)
 */
export function EnvironmentBadge() {
  if (!config.features.showEnvironmentBadge) {
    return null;
  }

  const colorClass = config.getEnvironmentColor();
  const envName = config.getEnvironmentName();

  return (
    <span
      className={`${colorClass} text-white text-xs px-2 py-1 rounded font-medium`}
    >
      {envName}
    </span>
  );
}

/**
 * Environment Information Panel (for settings/about page)
 */
export function EnvironmentInfo() {
  return (
    <div className="border rounded-lg p-4 space-y-2">
      <h3 className="font-semibold text-lg">Environment Information</h3>
      <dl className="space-y-1 text-sm">
        <div className="flex gap-2">
          <dt className="font-medium min-w-32">Environment:</dt>
          <dd className="flex items-center gap-2">
            {config.getEnvironmentName()}
            <EnvironmentBadge />
          </dd>
        </div>

        {config.deployment.branch && (
          <div className="flex gap-2">
            <dt className="font-medium min-w-32">Branch:</dt>
            <dd className="font-mono">{config.deployment.branch}</dd>
          </div>
        )}

        {config.deployment.commitSha && (
          <div className="flex gap-2">
            <dt className="font-medium min-w-32">Commit:</dt>
            <dd className="font-mono">{config.deployment.commitSha.slice(0, 7)}</dd>
          </div>
        )}

        {config.deployment.url && (
          <div className="flex gap-2">
            <dt className="font-medium min-w-32">Deployment URL:</dt>
            <dd className="font-mono text-xs break-all">
              {config.deployment.url}
            </dd>
          </div>
        )}

        <div className="flex gap-2">
          <dt className="font-medium min-w-32">Supabase URL:</dt>
          <dd className="font-mono text-xs break-all">
            {config.supabase.url || 'Not configured'}
          </dd>
        </div>

        <div className="flex gap-2">
          <dt className="font-medium min-w-32">Debug Mode:</dt>
          <dd>{config.features.debugMode ? 'Enabled' : 'Disabled'}</dd>
        </div>
      </dl>
    </div>
  );
}
