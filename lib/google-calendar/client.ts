import { google } from "googleapis";

/**
 * Google Calendar API client for fetching prickle events
 * Uses service account authentication (no OAuth required)
 */
export class GoogleCalendarClient {
  private calendar;

  constructor() {
    // Use service account credentials from environment
    const credentials = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
      ? JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY)
      : null;

    if (!credentials) {
      throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY not configured");
    }

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
    });

    this.calendar = google.calendar({ version: "v3", auth });
  }

  /**
   * List events from a calendar within a date range
   * Uses pagination to fetch all events (Google Calendar API has max 2500 per request)
   */
  async listEvents(
    calendarId: string,
    timeMin: string,
    timeMax: string
  ): Promise<any[]> {
    try {
      let allEvents: any[] = [];
      let pageToken: string | undefined;

      do {
        const response = await this.calendar.events.list({
          calendarId,
          timeMin,
          timeMax,
          singleEvents: true,
          orderBy: "startTime",
          maxResults: 250, // Use reasonable page size for pagination
          pageToken,
        });

        allEvents = allEvents.concat(response.data.items || []);
        pageToken = response.data.nextPageToken || undefined;
      } while (pageToken);

      return allEvents;
    } catch (error: any) {
      console.error("Error fetching calendar events:", error);
      throw new Error(
        `Failed to fetch calendar events: ${error.message || "Unknown error"}`
      );
    }
  }

  /**
   * Open a push channel: Google POSTs to `address` (with `token` in X-Goog-Channel-Token)
   * whenever an event on the calendar changes. Returns Google's resource id and the real expiry.
   */
  async watchEvents(params: {
    calendarId: string;
    channelId: string;
    address: string;
    token: string;
    expiration: Date;
  }): Promise<{ resourceId: string; expiresAt: Date }> {
    const response = await this.calendar.events.watch({
      calendarId: params.calendarId,
      requestBody: {
        id: params.channelId,
        type: "web_hook",
        address: params.address,
        token: params.token,
        expiration: String(params.expiration.getTime()),
      },
    });
    const { resourceId, expiration } = response.data;
    if (!resourceId || !expiration) {
      throw new Error("Google Calendar watch response is missing resourceId or expiration");
    }
    return { resourceId, expiresAt: new Date(Number(expiration)) };
  }

  /** Stop a push channel. Google needs both ids from the original watch response. */
  async stopChannel(channelId: string, resourceId: string): Promise<void> {
    await this.calendar.channels.stop({ requestBody: { id: channelId, resourceId } });
  }

  /**
   * Get primary calendar ID for the authenticated user
   */
  async getPrimaryCalendarId(): Promise<string> {
    try {
      const response = await this.calendar.calendarList.list({
        maxResults: 1,
      });

      const calendars = response.data.items || [];
      if (calendars.length === 0) {
        throw new Error("No calendars found");
      }

      return calendars[0].id || "primary";
    } catch (error: any) {
      console.error("Error fetching calendar list:", error);
      throw new Error(
        `Failed to fetch calendar list: ${error.message || "Unknown error"}`
      );
    }
  }
}
