/**
 * The cookie that lets a server action know which visit it belongs to. The browser sets it only
 * while usage tracking is allowed (components/AnalyticsEvents.tsx turns that on, after consent where
 * consent is required) and clears it when tracking stops, so the server never records an outcome
 * for someone who hasn't agreed: no cookie, no event. It holds the visit's random session id
 * (lib/analytics/client.ts), nothing about the person, and lives as long as the visit stays idle.
 */
export const SESSION_COOKIE = "hub_sid";
