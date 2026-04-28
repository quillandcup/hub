/**
 * Kajabi API Client
 *
 * Handles authentication and API calls to Kajabi's REST API.
 * Documentation: https://help.kajabi.com/api-reference/introduction
 */

const KAJABI_API_BASE = 'https://api.kajabi.com';

export interface KajabiContact {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  name: string;
  created_at: string;
  updated_at: string;
  last_contacted: string | null;
  last_activity: string | null;
  tags: string[];
  custom_fields: Record<string, any>;
  [key: string]: any;
}

export interface KajabiSubscription {
  id: string;
  customer_id: string;
  customer_name: string;
  customer_email: string;
  status: 'Active' | 'Canceled' | 'Paused' | 'Pending Cancellation';
  amount: string;
  currency: string;
  interval: string;
  created_at: string;
  canceled_on: string | null;
  trial_ends_on: string | null;
  next_payment_date: string | null;
  offer_id: string;
  offer_title: string;
  provider: string;
  provider_id: string;
  [key: string]: any;
}

export class KajabiClient {
  private clientId: string;
  private clientSecret: string;
  private accessToken: string | null = null;
  private tokenExpiry: number | null = null;

  constructor(clientId: string, clientSecret: string) {
    if (!clientId || !clientSecret) {
      throw new Error('Kajabi Client ID and Client Secret are required');
    }
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  /**
   * Get OAuth access token using client credentials flow
   * See: https://help.kajabi.com/api-reference/authentication/get-access-token
   */
  private async getAccessToken(): Promise<string> {
    // Return cached token if still valid
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    // Build form-encoded body
    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });

    const response = await fetch(`${KAJABI_API_BASE}/v1/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Kajabi OAuth error (${response.status}): ${errorText || response.statusText}`
      );
    }

    const data = await response.json();

    if (!data.access_token) {
      throw new Error('Kajabi OAuth response missing access_token');
    }

    const token: string = data.access_token;
    this.accessToken = token;
    // Set expiry to 90% of actual expiry to refresh before it expires
    this.tokenExpiry = Date.now() + (data.expires_in * 1000 * 0.9);

    return token;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${KAJABI_API_BASE}${endpoint}`;
    const token = await this.getAccessToken();

    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Kajabi API error (${response.status}): ${errorText || response.statusText}`
      );
    }

    return response.json();
  }

  /**
   * Fetch all contacts with pagination support
   */
  async *fetchContactsPaginated(): AsyncGenerator<KajabiContact[]> {
    let page = 1;
    const perPage = 100; // Kajabi's max per page
    let hasMore = true;

    while (hasMore) {
      const response: any = await this.request(
        `/v1/contacts?page=${page}&per_page=${perPage}`
      );

      if (response.contacts && response.contacts.length > 0) {
        yield response.contacts;
        page++;
        hasMore = response.contacts.length === perPage;
      } else {
        hasMore = false;
      }

      // Small delay to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /**
   * Fetch all contacts at once
   */
  async fetchAllContacts(): Promise<KajabiContact[]> {
    const allContacts: KajabiContact[] = [];

    for await (const batch of this.fetchContactsPaginated()) {
      allContacts.push(...batch);
    }

    return allContacts;
  }

  /**
   * Fetch all subscriptions with pagination support
   */
  async *fetchSubscriptionsPaginated(): AsyncGenerator<KajabiSubscription[]> {
    let page = 1;
    const perPage = 100;
    let hasMore = true;

    while (hasMore) {
      const response: any = await this.request(
        `/v1/subscriptions?page=${page}&per_page=${perPage}`
      );

      if (response.subscriptions && response.subscriptions.length > 0) {
        yield response.subscriptions;
        page++;
        hasMore = response.subscriptions.length === perPage;
      } else {
        hasMore = false;
      }

      // Small delay to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /**
   * Fetch all subscriptions at once
   */
  async fetchAllSubscriptions(): Promise<KajabiSubscription[]> {
    const allSubscriptions: KajabiSubscription[] = [];

    for await (const batch of this.fetchSubscriptionsPaginated()) {
      allSubscriptions.push(...batch);
    }

    return allSubscriptions;
  }
}

/**
 * Create a Kajabi client from environment variables
 */
export function createKajabiClient(): KajabiClient {
  const clientId = process.env.KAJABI_CLIENT_ID;
  const clientSecret = process.env.KAJABI_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('KAJABI_CLIENT_ID and KAJABI_CLIENT_SECRET environment variables are required');
  }

  return new KajabiClient(clientId, clientSecret);
}
