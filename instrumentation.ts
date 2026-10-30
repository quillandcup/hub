
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Captures all unhandled server-side request errors, tagged with their Next.js digest.
export { onRequestError } from "./lib/request-error";
