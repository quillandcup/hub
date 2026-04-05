interface ZoomTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface ZoomMeeting {
  uuid: string;
  id: number;
  topic: string;
  start_time: string;
  end_time: string;
}

interface ZoomMeetingsResponse {
  meetings: ZoomMeeting[];
  next_page_token?: string;
}

interface ZoomParticipant {
  id: string;
  user_id?: string;
  name: string;
  user_email?: string;
  join_time: string;
  leave_time: string;
  duration: number;
  attentiveness_score?: number;
  status?: string;
  failover?: boolean;
  registrant_id?: string;
}

interface ZoomParticipantsResponse {
  participants: ZoomParticipant[];
  next_page_token?: string;
}

export class ZoomClient {
  private baseUrl = 'https://api.zoom.us';
  private accountId: string;
  private clientId: string;
  private clientSecret: string;
  private token: string | null = null;
  private userEmail: string;

  constructor(accountId: string, clientId: string, clientSecret: string, userEmail: string = 'owner1@example.com') {
    this.accountId = accountId;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.userEmail = userEmail;
  }

  private async fetchWithRetry(
    url: string,
    options: RequestInit,
    maxRetries = 5
  ): Promise<Response> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(url, options);

        // If rate limited, wait and retry
        if (response.status === 429) {
          if (attempt === maxRetries) {
            throw new Error(`Rate limited after ${maxRetries} retries`);
          }

          // Exponential backoff: 1s, 2s, 4s, 8s, 16s
          const delayMs = Math.pow(2, attempt) * 1000;
          console.log(`Rate limited, waiting ${delayMs}ms before retry ${attempt + 1}/${maxRetries}`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }

        return response;
      } catch (error) {
        lastError = error as Error;
        if (attempt === maxRetries) {
          throw lastError;
        }

        // Network errors: shorter backoff
        const delayMs = 500 * (attempt + 1);
        console.log(`Network error, waiting ${delayMs}ms before retry ${attempt + 1}/${maxRetries}`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    throw lastError || new Error('Fetch failed');
  }

  private async getToken(): Promise<string> {
    if (this.token) {
      return this.token;
    }

    const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');

    const response = await this.fetchWithRetry(
      `${this.baseUrl}/oauth/token?grant_type=account_credentials&account_id=${this.accountId}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${credentials}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to get Zoom token: ${response.status} ${response.statusText}`);
    }

    const data: ZoomTokenResponse = await response.json();
    this.token = data.access_token;
    return this.token;
  }

  async listMeetings(fromDate: string, toDate: string): Promise<ZoomMeeting[]> {
    const token = await this.getToken();
    const meetings: ZoomMeeting[] = [];
    let nextPageToken: string | undefined = undefined;

    do {
      const params = new URLSearchParams({
        from: fromDate,
        to: toDate,
        page_size: '300',
      });

      if (nextPageToken) {
        params.set('next_page_token', nextPageToken);
      }

      const response = await this.fetchWithRetry(
        `${this.baseUrl}/v2/report/users/${this.userEmail}/meetings?${params}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to list meetings: ${response.status} ${response.statusText}`);
      }

      const data: ZoomMeetingsResponse = await response.json();
      meetings.push(...data.meetings);
      nextPageToken = data.next_page_token;
    } while (nextPageToken);

    return meetings;
  }

  async getParticipants(meetingUuid: string): Promise<ZoomParticipant[]> {
    const token = await this.getToken();
    const participants: ZoomParticipant[] = [];
    let nextPageToken: string | undefined = undefined;

    // Handle double-encoding for UUIDs that start with / or contain //
    let encodedUuid = meetingUuid;
    if (meetingUuid.startsWith('/') || meetingUuid.includes('//')) {
      encodedUuid = encodeURIComponent(encodeURIComponent(meetingUuid));
    }

    do {
      const params = new URLSearchParams({
        page_size: '300',
      });

      if (nextPageToken) {
        params.set('next_page_token', nextPageToken);
      }

      const response = await this.fetchWithRetry(
        `${this.baseUrl}/v2/report/meetings/${encodedUuid}/participants?${params}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to get participants for meeting ${meetingUuid}: ${response.status} ${response.statusText}`);
      }

      const data: ZoomParticipantsResponse = await response.json();
      participants.push(...data.participants);
      nextPageToken = data.next_page_token;
    } while (nextPageToken);

    return participants;
  }
}

export function createZoomClient(): ZoomClient {
  const accountId = process.env.ZOOM_ACCOUNT_ID;
  const clientId = process.env.ZOOM_CLIENT_ID;
  const clientSecret = process.env.ZOOM_CLIENT_SECRET;

  if (!accountId || !clientId || !clientSecret) {
    throw new Error('Missing Zoom credentials. Please set ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, and ZOOM_CLIENT_SECRET in .env.local');
  }

  return new ZoomClient(accountId, clientId, clientSecret);
}
