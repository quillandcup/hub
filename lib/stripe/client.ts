/**
 * Stripe API Client
 *
 * Uses official Stripe Node.js SDK
 * Documentation: https://stripe.com/docs/api
 */

import Stripe from 'stripe';

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
      apiVersion: '2026-04-22.dahlia',
    });
  }

  /**
   * Fetch all subscriptions (optionally filtered by status)
   */
  async fetchAllSubscriptions(status?: Stripe.Subscription.Status): Promise<Stripe.Subscription[]> {
    console.log(`[Stripe API] Fetching subscriptions${status ? ` with status=${status}` : ''}...`);

    const subscriptions = await fetchAll(
      (params) => this.stripe.subscriptions.list(params),
      status ? { status } : {}
    );

    console.log(`[Stripe API] Fetched ${subscriptions.length} total subscriptions`);
    return subscriptions;
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
