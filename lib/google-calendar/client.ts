import { google } from "googleapis";

/**
 * Google Calendar API client for fetching prickle events
 */
export class GoogleCalendarClient {
  private oauth2Client;
  private calendar;

  constructor() {
    this.oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    this.calendar = google.calendar({ version: "v3", auth: this.oauth2Client });
  }

  /**
   * Get OAuth authorization URL
   */
  getAuthUrl(): string {
    return this.oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: ["https://www.googleapis.com/auth/calendar.readonly"],
    });
  }

  /**
   * Exchange authorization code for tokens
   */
  async getTokensFromCode(code: string) {
    const { tokens } = await this.oauth2Client.getToken(code);
    this.oauth2Client.setCredentials(tokens);
    return tokens;
  }

  /**
   * Set tokens for authenticated requests
   */
  setTokens(tokens: any) {
    this.oauth2Client.setCredentials(tokens);
  }

  /**
   * List events from a calendar within a date range
   */
  async listEvents(
    calendarId: string,
    timeMin: string,
    timeMax: string
  ): Promise<any[]> {
    try {
      const response = await this.calendar.events.list({
        calendarId,
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 2500,
      });

      return response.data.items || [];
    } catch (error: any) {
      console.error("Error fetching calendar events:", error);
      throw new Error(
        `Failed to fetch calendar events: ${error.message || "Unknown error"}`
      );
    }
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
