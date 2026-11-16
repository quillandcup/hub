/**
 * Stripe API Client
 *
 * Uses official Stripe Node.js SDK
 * Documentation: https://stripe.com/docs/api
 */

import Stripe from 'stripe';
import { APP_URL, OUTBOUND_PRODUCT } from '@/lib/config';

/**
 * Helper to fetch all items from a paginated Stripe list
 */
async function fetchAll<T extends { id: string }>(
  list: (params?: any) => Stripe.ApiListPromise<T>,
  params: any = {}
): Promise<T[]> {
  const allItems: T[] = [];
  let hasMore = true;
  let startingAfter: string | undefined;

  while (hasMore) {
    const requestParams = {
      ...params,
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    };

    const response = await list(requestParams);
    allItems.push(...response.data);

    hasMore = response.has_more;
    if (hasMore && response.data.length > 0) {
      startingAfter = response.data[response.data.length - 1].id;
    }
  }

  return allItems;
}

/**
 * Wrapper around Stripe SDK with helper methods
 */
export class StripeClientWrapper {
  private stripe: Stripe;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('Stripe API key is required');
    }

    this.stripe = new Stripe(apiKey, {
      apiVersion: '2026-08-26.dahlia',
      // Stripe adds this to its own User-Agent clause (docs/OUTBOUND_REQUESTS.md).
      appInfo: { name: OUTBOUND_PRODUCT.name, version: OUTBOUND_PRODUCT.version, url: APP_URL },
    });
  }

  /**
   * Fetch all subscriptions (optionally filtered by status)
   */
  async fetchAllSubscriptions(status?: Stripe.SubscriptionListParams.Status): Promise<Stripe.Subscription[]> {
    console.log(`[Stripe API] Fetching subscriptions${status ? ` with status=${status}` : ''}...`);

    const subscriptions = await fetchAll(
      (params) => this.stripe.subscriptions.list(params),
      status ? { status } : {}
    );

    console.log(`[Stripe API] Fetched ${subscriptions.length} total subscriptions`);
    return subscriptions;
  }

  /**
   * Fetch invoices, newest first, from `createdFrom` (unix seconds) on when given, or with one status. The
   * payments are expanded (they link an invoice to its charges); payment methods are not.
   */
  async fetchInvoices(filter: { createdFrom?: number; status?: Stripe.InvoiceListParams.Status } = {}): Promise<Stripe.Invoice[]> {
    const params: Stripe.InvoiceListParams = { expand: ['data.payments'] };
    if (filter.createdFrom !== undefined) params.created = { gte: filter.createdFrom };
    if (filter.status) params.status = filter.status;
    const invoices = await fetchAll((p) => this.stripe.invoices.list(p), params);
    console.log(`[Stripe API] Fetched ${invoices.length} invoices`);
    return invoices;
  }

  /** One invoice with its payments, or null when Stripe no longer has it. */
  async retrieveInvoice(invoiceId: string): Promise<Stripe.Invoice | null> {
    try {
      return await this.stripe.invoices.retrieve(invoiceId, { expand: ['payments'] });
    } catch (error) {
      if ((error as { statusCode?: number })?.statusCode === 404) return null;
      throw error;
    }
  }

  /** Fetch charges, from `createdFrom` (unix seconds) on when given. */
  async fetchCharges(filter: { createdFrom?: number } = {}): Promise<Stripe.Charge[]> {
    const params: Stripe.ChargeListParams = filter.createdFrom !== undefined ? { created: { gte: filter.createdFrom } } : {};
    const charges = await fetchAll((p) => this.stripe.charges.list(p), params);
    console.log(`[Stripe API] Fetched ${charges.length} charges`);
    return charges;
  }

  /**
   * Fetch all customers
   */
  async fetchAllCustomers(): Promise<Stripe.Customer[]> {
    console.log('[Stripe API] Fetching customers...');
    const customers = await fetchAll((params) => this.stripe.customers.list(params));
    console.log(`[Stripe API] Fetched ${customers.length} total customers`);
    return customers;
  }

  /**
   * Fetch all products
   */
  async fetchAllProducts(): Promise<Stripe.Product[]> {
    console.log('[Stripe API] Fetching products...');
    const products = await fetchAll((params) => this.stripe.products.list(params));
    console.log(`[Stripe API] Fetched ${products.length} total products`);
    return products;
  }
}

/**
 * Create a Stripe client with credentials from environment variables
 */
export function createStripeClient(): StripeClientWrapper {
  const apiKey = process.env.STRIPE_API_KEY;

  if (!apiKey) {
    throw new Error('Missing STRIPE_API_KEY environment variable');
  }

  return new StripeClientWrapper(apiKey);
}
