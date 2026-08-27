/**
 * Consistent date/time formatting utilities
 * Eliminates duplicate toLocaleString() calls across the app
 */

/**
 * Format date and time without seconds
 * Example: "7/19/2026, 10:00 AM"
 */
export function formatDateTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString() + ', ' + d.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit'
  });
}

/**
 * Format time only without seconds
 * Example: "10:00 AM"
 */
export function formatTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit'
  });
}

/**
 * Format date only
 * Example: "7/19/2026"
 */
export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString();
}

/**
 * Format a date and time range
 * Example: "7/19/2026, 10:00 AM - 11:00 AM"
 */
export function formatDateTimeRange(start: Date | string, end: Date | string): string {
  const startDate = typeof start === 'string' ? new Date(start) : start;
  const endDate = typeof end === 'string' ? new Date(end) : end;

  // If same day, show date once
  if (startDate.toDateString() === endDate.toDateString()) {
    return `${formatDate(startDate)}, ${formatTime(startDate)} - ${formatTime(endDate)}`;
  }

  // Different days, show full date/time for both
  return `${formatDateTime(startDate)} - ${formatDateTime(endDate)}`;
}

/**
 * Format a time range (same day)
 * Example: "10:00 AM - 11:00 AM"
 */
export function formatTimeRange(start: Date | string, end: Date | string): string {
  return `${formatTime(start)} - ${formatTime(end)}`;
}

/**
 * Format a name as "First L" (first name + last initial)
 * Example: "Jenn Peterson" -> "Jenn P"
 */
export function hostShortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return parts[0] ?? name;
  return `${parts[0]} ${parts[parts.length - 1][0]}`;
}

type NameRef = { name: string } | { name: string }[] | null | undefined;

function unwrapRef<T extends { name: string }>(ref: T | T[] | null | undefined): T | undefined {
  return Array.isArray(ref) ? ref[0] : ref ?? undefined;
}

/**
 * Format a page title for a prickle, e.g. "Monday Progress Prickle with Jenn P"
 */
export function formatPrickleTitle(prickle: {
  start_time: string;
  host?: NameRef;
  prickle_types?: NameRef;
}): string {
  const host = unwrapRef(prickle.host);
  const prickleType = unwrapRef(prickle.prickle_types);
  const weekday = new Date(prickle.start_time).toLocaleDateString("en-US", { weekday: "long" });
  const typeName = prickleType?.name ?? "Prickle";
  return host?.name ? `${weekday} ${typeName} with ${hostShortName(host.name)}` : `${weekday} ${typeName}`;
}

/**
 * Format a relative time
 * Example: "2 hours ago", "in 3 days"
 */
export function formatRelativeTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffMins = Math.floor(Math.abs(diffMs) / (1000 * 60));
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  const isPast = diffMs < 0;

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return isPast ? `${diffMins}m ago` : `in ${diffMins}m`;
  if (diffHours < 24) return isPast ? `${diffHours}h ago` : `in ${diffHours}h`;
  if (diffDays < 30) return isPast ? `${diffDays}d ago` : `in ${diffDays}d`;

  return formatDate(d);
}
