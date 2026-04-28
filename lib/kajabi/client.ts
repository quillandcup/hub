/**
 * Kajabi API Client
 *
 * Handles authentication and API calls to Kajabi's REST API.
 * Documentation: https://help.kajabi.com/api-reference/introduction
 */

const KAJABI_API_BASE = 'https://api.kajabi.com';

export interface KajabiContact {
  id: string;
  type: 'contacts';
  attributes: {
    name: string;
    email: string;
    phone_number: string | null;
    business_number: string | null;
    subscribed: boolean;
    address_line_1: string | null;
    address_line_2: string | null;
    address_city: string | null;
    address_state: string | null;
    address_country: string | null;
    address_zip: string | null;
    external_user_id: string | null;
    custom_1: string | null;
    custom_2: string | null;
    custom_3: string | null;
    created_at: string;
    updated_at: string;
    [key: string]: any;
  };
  relationships?: Record<string, any>;
  links?: Record<string, any>;
}

export interface KajabiSubscription {
  id: string;
  type: 'subscriptions';
  attributes: {
    customer_id?: string;
    customer_name?: string;
    customer_email?: string;
    status: 'Active' | 'Canceled' | 'Paused' | 'Pending Cancellation';
    amount?: string;
    currency?: string;
    interval?: string;
    created_at: string;
    canceled_on?: string | null;
    trial_ends_on?: string | null;
    next_payment_date?: string | null;
    offer_id?: string;
    offer_title?: string;
    provider?: string;
    provider_id?: string;
    [key: string]: any;
  };
  relationships?: Record<string, any>;
  links?: Record<string, any>;
}

export class KajabiClient {
  private clientId: string;
  private clientSecret: string;
  private siteId: string;
  private accessToken: string | null = null;
  private tokenExpiry: number | null = null;

  constructor(clientId: string, clientSecret: string, siteId: string) {
    if (!clientId || !clientSecret) {
      throw new Error('Kajabi Client ID and Client Secret are required');
    }
    if (!siteId) {
      throw new Error('Kajabi Site ID is required');
    }
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.siteId = siteId;
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
      console.error('[Kajabi OAuth] Response missing access_token:', data);
      throw new Error('Kajabi OAuth response missing access_token');
    }

    const token: string = data.access_token;
    this.accessToken = token;
    // Set expiry to 90% of actual expiry to refresh before it expires
    this.tokenExpiry = Date.now() + (data.expires_in * 1000 * 0.9);

    console.log(`[Kajabi OAuth] Token acquired, expires in ${data.expires_in}s`);
    return token;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${KAJABI_API_BASE}${endpoint}`;
    const token = await this.getAccessToken();

    console.log(`[Kajabi API] ${options.method || 'GET'} ${url}`);

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
      console.error(`[Kajabi API] Error ${response.status} from ${url}:`, errorText.substring(0, 500));

      // Try to parse JSON error if available
      try {
        const errorJson = JSON.parse(errorText);
        throw new Error(
          `Kajabi API error (${response.status}): ${errorJson.error || JSON.stringify(errorJson)}`
        );
      } catch {
        // Not JSON, return text error
        throw new Error(
          `Kajabi API error (${response.status}): ${errorText.substring(0, 200) || response.statusText}`
        );
      }
    }

    return response.json();
  }

  /**
   * Fetch all contacts with pagination support
   * Uses JSON:API pagination format: page[number] and page[size]
   */
  async *fetchContactsPaginated(): AsyncGenerator<KajabiContact[]> {
    let pageNumber = 1;
    const pageSize = 100; // Kajabi's recommended page size
    let hasMore = true;

    while (hasMore) {
      const params = new URLSearchParams({
        'filter[site_id]': this.siteId,
        'page[number]': pageNumber.toString(),
        'page[size]': pageSize.toString(),
      });

      const response: any = await this.request(
        `/v1/contacts?${params.toString()}`
      );

      // JSON:API format: response.data contains the array
      const contacts = response.data || [];

      if (contacts.length > 0) {
        yield contacts;
        pageNumber++;

        // Check if there are more pages using meta or links
        hasMore = response.meta?.current_page < response.meta?.total_pages;
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
   * Uses JSON:API pagination format: page[number] and page[size]
   */
  async *fetchSubscriptionsPaginated(): AsyncGenerator<KajabiSubscription[]> {
    let pageNumber = 1;
    const pageSize = 100;
    let hasMore = true;

    while (hasMore) {
      const params = new URLSearchParams({
        'filter[site_id]': this.siteId,
        'page[number]': pageNumber.toString(),
        'page[size]': pageSize.toString(),
      });

      const response: any = await this.request(
        `/v1/subscriptions?${params.toString()}`
      );

      // JSON:API format: response.data contains the array
      const subscriptions = response.data || [];

      if (subscriptions.length > 0) {
        yield subscriptions;
        pageNumber++;

        // Check if there are more pages using meta or links
        hasMore = response.meta?.current_page < response.meta?.total_pages;
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
  const siteId = process.env.KAJABI_SITE_ID;

  if (!clientId || !clientSecret) {
    throw new Error('KAJABI_CLIENT_ID and KAJABI_CLIENT_SECRET environment variables are required');
  }

  if (!siteId) {
    throw new Error('KAJABI_SITE_ID environment variable is required. Find it in your Kajabi admin URL (e.g., /admin/sites/2147577478)');
  }

  return new KajabiClient(clientId, clientSecret, siteId);
}
