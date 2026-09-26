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
  /** Not a native Kajabi field — resolved from relationships.tags + the
   *  `include=tags` response by fetchContactsPaginated below, so callers
   *  don't need a separate contact_tags lookup. Tag names, e.g. ["Ideal Hedgie"]. */
  tags?: string[];
}

export interface KajabiPurchase {
  id: string;
  type: 'purchases';
  attributes: {
    amount_in_cents: number;
    created_at: string;
    deactivated_at: string | null;
    deactivation_reason: string | null;
    effective_start_at: string;
    multipay_payments_made: number;
    [key: string]: any;
  };
  relationships?: {
    customer?: { data: { id: string; type: 'customers' } };
    offer?: { data: { id: string; type: 'offers' } };
    [key: string]: any;
  };
  links?: Record<string, any>;
}

// Alias for backwards compatibility
export type KajabiSubscription = KajabiPurchase;

export interface KajabiOffer {
  id: string;
  type: 'offers';
  attributes: {
    name: string;
    status: string;
    trial_period_days: number | null;
    created_at: string;
    updated_at: string;
    [key: string]: any;
  };
  relationships?: Record<string, any>;
  links?: Record<string, any>;
}

/** Contact attributes this app writes back to Kajabi via PATCH /v1/contacts/{id}. */
export type KajabiWritableContactAttribute = 'name' | 'email' | 'custom_1' | 'custom_2' | 'custom_3';

/**
 * Resolve each contact's tags relationship (contact_tags IDs) into plain tag
 * names via the response's `included` array (requires `include=tags`),
 * attached as `contact.tags`.
 */
function resolveContactTags(contacts: KajabiContact[], included: any[] | undefined): void {
  const tagNameById = new Map<string, string>();
  for (const item of included || []) {
    if (item.type === 'contact_tags' && item.attributes?.name) {
      tagNameById.set(item.id, item.attributes.name);
    }
  }
  for (const contact of contacts) {
    const tagRefs = contact.relationships?.tags?.data || [];
    contact.tags = tagRefs
      .map((ref: { id: string }) => tagNameById.get(ref.id))
      .filter((name: string | undefined): name is string => Boolean(name));
  }
}

/**
 * Bronze `kajabi_contacts` row for a Kajabi contact. Shared by the full
 * import (/api/import/kajabi) and the targeted single-contact refresh so both
 * write identical rows (UPSERT on kajabi_contact_id — idempotent).
 */
export function toKajabiContactBronzeRecord(contact: KajabiContact, importTimestamp: string) {
  return {
    kajabi_contact_id: contact.id,
    email: contact.attributes.email.toLowerCase(),
    name: contact.attributes.name,
    created_at_kajabi: contact.attributes.created_at,
    updated_at_kajabi: contact.attributes.updated_at,
    imported_at: importTimestamp,
    data: contact,
  };
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
   * Generic pagination helper for Kajabi JSON:API endpoints
   * Handles pagination, rate limiting, and logging
   */
  private async *fetchPaginated<T>(
    endpoint: string,
    resourceName: string
  ): AsyncGenerator<T[]> {
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
        `${endpoint}?${params.toString()}`
      );

      // JSON:API format: response.data contains the array
      const items = response.data || [];

      if (items.length > 0) {
        console.log(`[Kajabi API] ${resourceName} page ${pageNumber}: ${items.length} records (${response.meta?.current_page}/${response.meta?.total_pages} pages, ${response.meta?.total_count} total)`);
        yield items;
        pageNumber++;

        // Determine if there are more pages
        if (response.meta?.current_page != null && response.meta?.total_pages != null) {
          // Use meta info if available
          hasMore = response.meta.current_page < response.meta.total_pages;
        } else {
          // No meta info - continue if we got a full page
          hasMore = items.length === pageSize;
        }
      } else {
        hasMore = false;
      }

      // Small delay to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /**
   * Fetch all contacts with pagination support
   * Uses JSON:API pagination format: page[number] and page[size]
   *
   * Requests `include=tags` and resolves each contact's tag relationship
   * (a list of `contact_tags` IDs) into plain tag name strings via the
   * response's `included` array, attached as `contact.tags`. This is what
   * lets Silver processing (/api/process/members) find "Ideal Hedgie"-tagged
   * leads for the Outreach page without a separate contact_tags fetch/join.
   */
  async *fetchContactsPaginated(): AsyncGenerator<KajabiContact[]> {
    let pageNumber = 1;
    const pageSize = 100;
    let hasMore = true;

    while (hasMore) {
      const params = new URLSearchParams({
        'filter[site_id]': this.siteId,
        'page[number]': pageNumber.toString(),
        'page[size]': pageSize.toString(),
        'include': 'tags',
      });

      const response: any = await this.request(`/v1/contacts?${params.toString()}`);
      const items: KajabiContact[] = response.data || [];

      if (items.length > 0) {
        resolveContactTags(items, response.included);

        console.log(`[Kajabi API] Contacts page ${pageNumber}: ${items.length} records (${response.meta?.current_page}/${response.meta?.total_pages} pages, ${response.meta?.total_count} total)`);
        yield items;
        pageNumber++;

        if (response.meta?.current_page != null && response.meta?.total_pages != null) {
          hasMore = response.meta.current_page < response.meta.total_pages;
        } else {
          hasMore = items.length === pageSize;
        }
      } else {
        hasMore = false;
      }

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

    console.log(`[Kajabi API] Fetched ${allContacts.length} total contacts`);
    return allContacts;
  }

  /**
   * Fetch all customers with pagination support
   * Customers are similar to contacts but with purchase/revenue data
   */
  async *fetchCustomersPaginated(): AsyncGenerator<any[]> {
    yield* this.fetchPaginated('/v1/customers', 'Customers');
  }

  /**
   * Fetch all customers at once
   */
  async fetchAllCustomers(): Promise<any[]> {
    const allCustomers: any[] = [];

    for await (const batch of this.fetchCustomersPaginated()) {
      allCustomers.push(...batch);
    }

    console.log(`[Kajabi API] Fetched ${allCustomers.length} total customers`);
    return allCustomers;
  }

  /**
   * Fetch all purchases (subscriptions) with pagination support
   * Uses JSON:API pagination format: page[number] and page[size]
   * Note: Kajabi stores subscriptions as "purchases" in their API
   */
  async *fetchSubscriptionsPaginated(): AsyncGenerator<KajabiSubscription[]> {
    yield* this.fetchPaginated<KajabiSubscription>('/v1/purchases', 'Purchases');
  }

  /**
   * Fetch all subscriptions at once
   */
  async fetchAllSubscriptions(): Promise<KajabiSubscription[]> {
    const allSubscriptions: KajabiSubscription[] = [];

    for await (const batch of this.fetchSubscriptionsPaginated()) {
      allSubscriptions.push(...batch);
    }

    console.log(`[Kajabi API] Fetched ${allSubscriptions.length} total purchases`);
    return allSubscriptions;
  }

  /**
   * Fetch a single contact, shaped exactly like fetchContactsPaginated's items
   * (including the resolved `tags` name list), so it can be written to Bronze
   * with the same record shape as a full import. Used for a targeted refresh
   * after a member edits a Kajabi-owned field from the app.
   * See: https://help.kajabi.com/api-reference/contacts/contact-details
   */
  async fetchContact(contactId: string): Promise<KajabiContact> {
    const params = new URLSearchParams({ include: 'tags' });
    const response: any = await this.request(`/v1/contacts/${contactId}?${params.toString()}`);
    const contact: KajabiContact | undefined = response.data;
    if (!contact) throw new Error(`Kajabi returned no contact for id ${contactId}`);
    resolveContactTags([contact], response.included);
    return contact;
  }

  /**
   * Update a contact's attributes (e.g. name after a legal-name correction,
   * or a contact custom field like the "Instagram Handle" custom_1).
   * Kajabi's API has no equivalent for /v1/customers — customer profile
   * fields (public_bio, socials) are read-only.
   * See: https://help.kajabi.com/api-reference/contacts/update-contact
   */
  async updateContact(
    contactId: string,
    attributes: Partial<Pick<KajabiContact['attributes'], KajabiWritableContactAttribute>>
  ): Promise<KajabiContact> {
    const response = await this.request<{ data: KajabiContact }>(`/v1/contacts/${contactId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        data: { type: 'contacts', id: contactId, attributes },
      }),
    });
    return response.data;
  }

  /**
   * Fetch all offers with pagination support
   * Uses JSON:API pagination format: page[number] and page[size]
   */
  async *fetchOffersPaginated(): AsyncGenerator<KajabiOffer[]> {
    yield* this.fetchPaginated<KajabiOffer>('/v1/offers', 'Offers');
  }

  /**
   * Fetch all offers at once
   */
  async fetchAllOffers(): Promise<KajabiOffer[]> {
    const allOffers: KajabiOffer[] = [];

    for await (const batch of this.fetchOffersPaginated()) {
      allOffers.push(...batch);
    }

    console.log(`[Kajabi API] Fetched ${allOffers.length} total offers`);
    return allOffers;
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
