import { chunk, fetchAllRows } from "@/lib/supabase/paginate";
import { escapeLike, inChunks as inChunksOf, sortByKey, upsertInChunks } from "./query";
import type { Database, Json } from "./database.types";
import type { Db } from "./db";
import type { InMemoryDataset } from "./in-memory";

type Tables = Database["bronze"]["Tables"];

/** A Kajabi contact (anyone in Kajabi) as the import keeps it (`bronze.kajabi_contacts`). */
export type KajabiContactRow = Tables["kajabi_contacts"]["Row"];
/** A Kajabi customer (someone who bought) (`bronze.kajabi_customers`). */
export type KajabiCustomerRow = Tables["kajabi_customers"]["Row"];
/** A Kajabi purchase of an offer (`bronze.kajabi_purchases`). */
export type KajabiPurchaseRow = Tables["kajabi_purchases"]["Row"];
/** A Kajabi offer (`bronze.kajabi_offers`). */
export type KajabiOfferRow = Tables["kajabi_offers"]["Row"];
/** A Stripe customer (`bronze.stripe_customers`). */
export type StripeCustomerRow = Tables["stripe_customers"]["Row"];
/** A Stripe product (`bronze.stripe_products`). */
export type StripeProductRow = Tables["stripe_products"]["Row"];
/** A Stripe subscription (`bronze.stripe_subscriptions`). */
export type StripeSubscriptionRow = Tables["stripe_subscriptions"]["Row"];
/** A Stripe invoice (`bronze.stripe_invoices`): amounts in cents, no raw record, no customer details. */
export type StripeInvoiceRow = Tables["stripe_invoices"]["Row"];
/** A Stripe charge (`bronze.stripe_charges`): amounts in cents, no card details, the failure code only. */
export type StripeChargeRow = Tables["stripe_charges"]["Row"];

/** What the imports write: the columns of each table (the raw record included). */
export type NewKajabiContact = Tables["kajabi_contacts"]["Insert"];
export type NewKajabiCustomer = Tables["kajabi_customers"]["Insert"];
export type NewKajabiPurchase = Tables["kajabi_purchases"]["Insert"];
export type NewKajabiOffer = Tables["kajabi_offers"]["Insert"];
export type NewKajabiMember = Tables["kajabi_members"]["Insert"];
export type NewStripeCustomer = Tables["stripe_customers"]["Insert"];
export type NewStripeProduct = Tables["stripe_products"]["Insert"];
export type NewStripeSubscription = Tables["stripe_subscriptions"]["Insert"];
export type NewStripeInvoice = Tables["stripe_invoices"]["Insert"];
export type NewStripeCharge = Tables["stripe_charges"]["Insert"];
export type NewSubscriptionHistory = Tables["subscription_history"]["Insert"];

export type KajabiContactRef = Pick<KajabiContactRow, "kajabi_contact_id" | "email" | "name">;
export type KajabiCustomerFilter = { emails: string[]; customerIds?: never } | { customerIds: string[]; emails?: never };
export type KajabiCustomerRef = Pick<KajabiCustomerRow, "kajabi_customer_id" | "email">;
/** What a customer says about themselves (the raw record) and when Kajabi last changed it. */
export type KajabiCustomerProfile = Pick<KajabiCustomerRow, "data" | "updated_at_kajabi">;
export type KajabiOfferRef = Pick<KajabiOfferRow, "kajabi_offer_id" | "name">;
export type KajabiOfferDetail = Pick<KajabiOfferRow, "kajabi_offer_id" | "name" | "data" | "trial_period_days">;
/** A purchase without its raw record: who bought what, when it started and whether it was deactivated. */
export type KajabiPurchaseSummary = Pick<
  KajabiPurchaseRow,
  "kajabi_purchase_id" | "kajabi_customer_id" | "kajabi_offer_id" | "status" | "amount_in_cents" | "created_at_kajabi" | "effective_start_at" | "deactivated_at"
>;
export type StripeCustomerRef = Pick<StripeCustomerRow, "stripe_customer_id" | "email" | "name" | "created_at_stripe">;
export type StripeCustomerWithData = Pick<StripeCustomerRow, "stripe_customer_id" | "email" | "data">;
export type StripeProductRef = Pick<StripeProductRow, "stripe_product_id" | "name">;
export type StripeSubscriptionStatus = Pick<StripeSubscriptionRow, "stripe_customer_id" | "status">;
export type StripeSubscriptionDetail = Pick<StripeSubscriptionRow, "stripe_subscription_id" | "stripe_customer_id" | "status" | "created_at_stripe" | "canceled_at" | "data">;
/** What the trial and conversion dates are read from. */
export type StripeSubscriptionTrial = Pick<StripeSubscriptionRow, "stripe_customer_id" | "created_at_stripe" | "canceled_at" | "data">;

/** Seeds for the in-memory twin: the key columns, anything else a test names (the rest default). */
export type KajabiContactSeed = Pick<KajabiContactRow, "kajabi_contact_id"> & Partial<KajabiContactRow>;
export type KajabiCustomerSeed = Pick<KajabiCustomerRow, "kajabi_customer_id" | "email"> & Partial<KajabiCustomerRow>;
export type KajabiPurchaseSeed = Pick<KajabiPurchaseRow, "kajabi_purchase_id"> & Partial<KajabiPurchaseRow>;
export type KajabiOfferSeed = Pick<KajabiOfferRow, "kajabi_offer_id"> & Partial<KajabiOfferRow>;
export type StripeCustomerSeed = Pick<StripeCustomerRow, "stripe_customer_id"> & Partial<StripeCustomerRow>;
export type StripeProductSeed = Pick<StripeProductRow, "stripe_product_id" | "name"> & Partial<StripeProductRow>;
export type StripeSubscriptionSeed = Pick<StripeSubscriptionRow, "stripe_subscription_id" | "stripe_customer_id"> & Partial<StripeSubscriptionRow>;
export type StripeInvoiceSeed = Pick<StripeInvoiceRow, "stripe_invoice_id" | "stripe_customer_id"> & Partial<StripeInvoiceRow>;
export type StripeChargeSeed = Pick<StripeChargeRow, "stripe_charge_id"> & Partial<StripeChargeRow>;

/** Which invoices or charges to read: `createdFrom` (inclusive) and `createdTo` (exclusive) are instants; `customerIds` narrows to those Stripe customers (chunked). */
export interface StripeBillingFilter {
  customerIds?: string[];
  createdFrom?: string;
  createdTo?: string;
}

const ID_CHUNK = 100;
const WRITE_CHUNK = 500;
const EPOCH = "1970-01-01T00:00:00.000Z";

/**
 * The Kajabi and Stripe billing data as the imports keep it in Bronze: contacts, customers, purchases
 * and offers from Kajabi, customers, products and subscriptions from Stripe. Who is a member, and
 * whether a trial converted, is derived from these elsewhere (lib/kajabi/membership-history.ts,
 * lib/stripe-matching.ts); this is where they are read from. Every read that can pass 1000 rows pages
 * through a stable order (the table's natural key), every id or email list is chunked, and a database
 * error throws instead of reading as an empty table.
 */
export interface BillingRepository {
  // --- Kajabi contacts ---
  /** Every contact: id, email, name. */
  kajabiContacts(): Promise<KajabiContactRef[]>;
  /** Every contact with its raw record (what member processing reads). */
  kajabiContactRows(): Promise<KajabiContactRow[]>;
  /** One contact's raw record, or null when there is no such contact. */
  kajabiContactData(kajabiContactId: string): Promise<Json | null>;
  /** When the newest contact was imported, or null when none was. */
  lastKajabiContactImportAt(): Promise<string | null>;

  // --- Kajabi customers ---
  /** Every customer: id and email. `emails` narrows to the customers with one of these emails (exact match), `customerIds` to these customers (those that exist); either is chunked. One filter at a time. */
  kajabiCustomers(filter?: KajabiCustomerFilter): Promise<KajabiCustomerRef[]>;
  /** Every customer with its raw record (what member processing reads). */
  kajabiCustomerRows(): Promise<KajabiCustomerRow[]>;
  /** The raw record and last-changed time of the customers with one of these emails. Chunked. */
  kajabiCustomerProfilesByEmail(emails: string[]): Promise<KajabiCustomerProfile[]>;

  // --- Kajabi offers ---
  /** Every offer with its raw record. */
  kajabiOfferRows(): Promise<KajabiOfferRow[]>;
  /** The distinct offer names, alphabetical (offers without a name are left out). */
  kajabiOfferNames(): Promise<string[]>;
  /** The offers with one of these names. */
  kajabiOffersByName(names: string[]): Promise<KajabiOfferRef[]>;
  /** These offers (those that exist) with their raw record and trial length. Chunked. */
  kajabiOffersByIds(offerIds: string[]): Promise<KajabiOfferDetail[]>;

  // --- Kajabi purchases ---
  /** Purchases with their raw record. `offerIds` narrows to those offers (none given: every purchase); `stillActive` leaves out deactivated ones. */
  kajabiPurchaseRows(filter?: { offerIds?: string[]; stillActive?: boolean }): Promise<KajabiPurchaseRow[]>;
  /** Purchases without their raw record. `offerIds` narrows to those offers (none given: every purchase); `createdSince` to those created at or after an instant. */
  kajabiPurchases(filter?: { offerIds?: string[]; createdSince?: string }): Promise<KajabiPurchaseSummary[]>;
  /** These customers' purchases, oldest created first (a purchase with no creation time last). Chunked. */
  kajabiPurchasesByCustomers(customerIds: string[]): Promise<KajabiPurchaseSummary[]>;
  /** The customers who have a purchase with status "active". `customerIds` narrows to those (chunked); none given: all of them. */
  activeKajabiPurchaseCustomerIds(customerIds?: string[]): Promise<Set<string>>;
  /** When the newest purchase was imported, or null when none was. */
  lastKajabiPurchaseImportAt(): Promise<string | null>;

  // --- Stripe ---
  /** Every customer: id, email, name. `emails` narrows to those with one of these emails (chunked). */
  stripeCustomers(filter?: { emails?: string[] }): Promise<StripeCustomerRef[]>;
  /** Every customer with its raw record. */
  stripeCustomersWithData(): Promise<StripeCustomerWithData[]>;
  /** The products with one of these names. */
  stripeProductsByName(names: string[]): Promise<StripeProductRef[]>;
  /** One row per subscription with one of these statuses. `customerIds` narrows to those customers (chunked). */
  stripeSubscriptionStatuses(statuses: string[], customerIds?: string[]): Promise<StripeSubscriptionStatus[]>;
  /** Every subscription with its raw record. */
  stripeSubscriptionRows(): Promise<StripeSubscriptionRow[]>;
  /** Every subscription with this status, with its raw record. */
  stripeSubscriptionsWithStatus(status: string): Promise<StripeSubscriptionDetail[]>;
  /** These customers' subscriptions: when created and canceled, and the raw record (trial dates). Chunked. */
  stripeSubscriptionsByCustomers(stripeCustomerIds: string[]): Promise<StripeSubscriptionTrial[]>;
  /** When the newest subscription was imported, or null when none was. */
  lastStripeSubscriptionImportAt(): Promise<string | null>;
  /** Invoices, oldest created first (then by id), narrowed by the filter. Pages past 1000 rows. */
  stripeInvoices(filter?: StripeBillingFilter): Promise<StripeInvoiceRow[]>;
  /** The same invoices grouped per Stripe customer, each customer's oldest first. A customer with none is absent. */
  stripeInvoicesByCustomers(filter?: StripeBillingFilter): Promise<Map<string, StripeInvoiceRow[]>>;
  /** Charges, oldest created first (then by id), narrowed by the filter. Pages past 1000 rows. */
  stripeCharges(filter?: StripeBillingFilter): Promise<StripeChargeRow[]>;
  /** When the newest stored invoice (charge) was created at Stripe, or null when there is none: where an incremental import starts. */
  newestStripeInvoiceCreatedAt(): Promise<string | null>;
  newestStripeChargeCreatedAt(): Promise<string | null>;
  /** The Stripe ids of the stored invoices with one of these statuses (the open and draft ones change, so an import asks Stripe about them again). */
  stripeInvoiceIdsWithStatus(statuses: string[]): Promise<string[]>;

  // --- the imports' writes (Bronze: upsert on the natural key, so a re-import never duplicates) ---
  /** Adds contacts, or replaces the ones with the same Kajabi contact id. Written in chunks. */
  upsertKajabiContacts(rows: NewKajabiContact[]): Promise<void>;
  /** Sets the email of one contact, when Kajabi has changed it and the full refresh did not work. */
  setKajabiContactEmail(kajabiContactId: string, email: string): Promise<void>;
  /** The contacts with this email, whatever its case (Kajabi keeps emails unique, so normally one). */
  kajabiContactsByEmail(email: string): Promise<KajabiContactRef[]>;
  /** Removes one contact from the Bronze copy, after it was deleted in Kajabi (the next import would not bring it back). */
  deleteKajabiContact(kajabiContactId: string): Promise<void>;
  /** Adds customers, or replaces the ones with the same Kajabi customer id. Written in chunks. */
  upsertKajabiCustomers(rows: NewKajabiCustomer[]): Promise<void>;
  /** Adds purchases, or replaces the ones with the same Kajabi purchase id. Written in chunks. */
  upsertKajabiPurchases(rows: NewKajabiPurchase[]): Promise<void>;
  /** Adds offers, or replaces the ones with the same Kajabi offer id. Written in chunks. */
  upsertKajabiOffers(rows: NewKajabiOffer[]): Promise<void>;
  /** Adds one snapshot row per member of a members export (append only: processing reads the latest import). Written in chunks. */
  insertKajabiMembers(rows: NewKajabiMember[]): Promise<void>;
  /** Adds Stripe customers, or replaces the ones with the same Stripe customer id. Written in chunks. */
  upsertStripeCustomers(rows: NewStripeCustomer[]): Promise<void>;
  /** Adds Stripe products, or replaces the ones with the same Stripe product id. Written in chunks. */
  upsertStripeProducts(rows: NewStripeProduct[]): Promise<void>;
  /** Adds Stripe subscriptions, or replaces the ones with the same Stripe subscription id. Written in chunks. */
  upsertStripeSubscriptions(rows: NewStripeSubscription[]): Promise<void>;
  /** Adds Stripe invoices, or replaces the ones with the same Stripe invoice id. Written in chunks. */
  upsertStripeInvoices(rows: NewStripeInvoice[]): Promise<void>;
  /** Adds Stripe charges, or replaces the ones with the same Stripe charge id. Written in chunks. */
  upsertStripeCharges(rows: NewStripeCharge[]): Promise<void>;
  /** Adds subscription export rows, or replaces the ones with the same Kajabi subscription id and import time. Returns how many rows were written. */
  upsertSubscriptionHistory(rows: NewSubscriptionHistory[]): Promise<number>;
}

/** Runs a query for each chunk of the distinct values, together, and joins the rows. */
const inChunks = <T>(values: string[], run: (part: string[]) => Promise<T[]>) => inChunksOf(values, ID_CHUNK, run);

export class SupabaseBillingRepository implements BillingRepository {
  constructor(private readonly db: Db) {}

  private get contacts() {
    return this.db.schema("bronze").from("kajabi_contacts");
  }
  private get customers() {
    return this.db.schema("bronze").from("kajabi_customers");
  }
  private get purchases() {
    return this.db.schema("bronze").from("kajabi_purchases");
  }
  private get offers() {
    return this.db.schema("bronze").from("kajabi_offers");
  }
  private get stripeCustomerTable() {
    return this.db.schema("bronze").from("stripe_customers");
  }
  private get products() {
    return this.db.schema("bronze").from("stripe_products");
  }
  private get subscriptions() {
    return this.db.schema("bronze").from("stripe_subscriptions");
  }
  private get invoices() {
    return this.db.schema("bronze").from("stripe_invoices");
  }
  private get charges() {
    return this.db.schema("bronze").from("stripe_charges");
  }

  private async newest(table: "kajabi_contacts" | "kajabi_purchases" | "stripe_subscriptions"): Promise<string | null> {
    const { data, error } = await this.db.schema("bronze").from(table).select("imported_at").order("imported_at", { ascending: false }).limit(1);
    if (error) throw new Error(error.message);
    return data?.[0]?.imported_at ?? null;
  }

  async kajabiContacts() {
    return fetchAllRows<KajabiContactRef>((from, to) =>
      this.contacts.select("kajabi_contact_id, email, name").order("kajabi_contact_id").range(from, to)
    );
  }

  async kajabiContactRows() {
    return fetchAllRows<KajabiContactRow>((from, to) => this.contacts.select("*").order("kajabi_contact_id").range(from, to));
  }

  async kajabiContactData(kajabiContactId: string) {
    const { data, error } = await this.contacts.select("data").eq("kajabi_contact_id", kajabiContactId).maybeSingle();
    if (error) throw new Error(error.message);
    return data?.data ?? null;
  }

  lastKajabiContactImportAt() {
    return this.newest("kajabi_contacts");
  }

  async kajabiCustomers(filter?: KajabiCustomerFilter) {
    const column = filter?.emails ? "email" : "kajabi_customer_id";
    const values = filter?.emails ?? filter?.customerIds;
    const read = (part?: string[]) =>
      fetchAllRows<KajabiCustomerRef>((from, to) => {
        let query = this.customers.select("kajabi_customer_id, email");
        if (part) query = query.in(column, part);
        return query.order("kajabi_customer_id").range(from, to);
      });
    if (!values) return read();
    return sortByKey(await inChunks(values, read), (r) => r.kajabi_customer_id);
  }

  async kajabiCustomerRows() {
    return fetchAllRows<KajabiCustomerRow>((from, to) => this.customers.select("*").order("kajabi_customer_id").range(from, to));
  }

  async kajabiCustomerProfilesByEmail(emails: string[]) {
    return inChunks(emails, (part) =>
      fetchAllRows<KajabiCustomerProfile>((from, to) =>
        this.customers.select("data, updated_at_kajabi").in("email", part).order("kajabi_customer_id").range(from, to)
      )
    );
  }

  async kajabiOfferRows() {
    return fetchAllRows<KajabiOfferRow>((from, to) => this.offers.select("*").order("kajabi_offer_id").range(from, to));
  }

  async kajabiOfferNames() {
    const rows = await fetchAllRows<Pick<KajabiOfferRow, "name">>((from, to) =>
      this.offers.select("name").order("kajabi_offer_id").range(from, to)
    );
    return [...new Set(rows.map((o) => o.name).filter((n): n is string => !!n))].sort((a, b) => a.localeCompare(b));
  }

  async kajabiOffersByName(names: string[]) {
    const rows = await inChunks(names, (part) =>
      fetchAllRows<KajabiOfferRef>((from, to) =>
        this.offers.select("kajabi_offer_id, name").in("name", part).order("kajabi_offer_id").range(from, to)
      )
    );
    return sortByKey(rows, (r) => r.kajabi_offer_id);
  }

  async kajabiOffersByIds(offerIds: string[]) {
    const rows = await inChunks(offerIds, (part) =>
      fetchAllRows<KajabiOfferDetail>((from, to) =>
        this.offers.select("kajabi_offer_id, name, data, trial_period_days").in("kajabi_offer_id", part).order("kajabi_offer_id").range(from, to)
      )
    );
    return sortByKey(rows, (r) => r.kajabi_offer_id);
  }

  async kajabiPurchaseRows({ offerIds, stillActive = false }: { offerIds?: string[]; stillActive?: boolean } = {}) {
    const read = (part?: string[]) =>
      fetchAllRows<KajabiPurchaseRow>((from, to) => {
        let query = this.purchases.select("*");
        if (part) query = query.in("kajabi_offer_id", part);
        if (stillActive) query = query.is("deactivated_at", null);
        return query.order("kajabi_purchase_id").range(from, to);
      });
    if (!offerIds) return read();
    return sortByKey(await inChunks(offerIds, read), (r) => r.kajabi_purchase_id);
  }

  async kajabiPurchases({ offerIds, createdSince }: { offerIds?: string[]; createdSince?: string } = {}) {
    const read = (part?: string[]) =>
      fetchAllRows<KajabiPurchaseSummary>((from, to) => {
        let query = this.purchases.select(PURCHASE_SUMMARY_COLUMNS);
        if (part) query = query.in("kajabi_offer_id", part);
        if (createdSince) query = query.gte("created_at_kajabi", createdSince);
        return query.order("kajabi_purchase_id").range(from, to);
      });
    if (!offerIds) return read();
    return sortByKey(await inChunks(offerIds, read), (r) => r.kajabi_purchase_id);
  }

  async kajabiPurchasesByCustomers(customerIds: string[]) {
    const rows = await inChunks(customerIds, (part) =>
      fetchAllRows<KajabiPurchaseSummary>((from, to) =>
        this.purchases.select(PURCHASE_SUMMARY_COLUMNS).in("kajabi_customer_id", part).order("kajabi_purchase_id").range(from, to)
      )
    );
    return byCreated(rows);
  }

  async activeKajabiPurchaseCustomerIds(customerIds?: string[]) {
    const read = (part?: string[]) =>
      fetchAllRows<{ kajabi_customer_id: string | null }>((from, to) => {
        let query = this.purchases.select("kajabi_customer_id").eq("status", "active");
        if (part) query = query.in("kajabi_customer_id", part);
        return query.order("kajabi_purchase_id").range(from, to);
      });
    const rows = customerIds ? await inChunks(customerIds, read) : await read();
    return new Set(rows.map((r) => r.kajabi_customer_id).filter((id): id is string => !!id));
  }

  lastKajabiPurchaseImportAt() {
    return this.newest("kajabi_purchases");
  }

  async stripeCustomers({ emails }: { emails?: string[] } = {}) {
    const read = (part?: string[]) =>
      fetchAllRows<StripeCustomerRef>((from, to) => {
        let query = this.stripeCustomerTable.select("stripe_customer_id, email, name, created_at_stripe");
        if (part) query = query.in("email", part);
        return query.order("stripe_customer_id").range(from, to);
      });
    if (!emails) return read();
    return sortByKey(await inChunks(emails, read), (r) => r.stripe_customer_id);
  }

  async stripeCustomersWithData() {
    return fetchAllRows<StripeCustomerWithData>((from, to) =>
      this.stripeCustomerTable.select("stripe_customer_id, email, data").order("stripe_customer_id").range(from, to)
    );
  }

  async stripeProductsByName(names: string[]) {
    const rows = await inChunks(names, (part) =>
      fetchAllRows<StripeProductRef>((from, to) =>
        this.products.select("stripe_product_id, name").in("name", part).order("stripe_product_id").range(from, to)
      )
    );
    return sortByKey(rows, (r) => r.stripe_product_id);
  }

  async stripeSubscriptionStatuses(statuses: string[], customerIds?: string[]) {
    const read = (part?: string[]) =>
      fetchAllRows<StripeSubscriptionStatus>((from, to) => {
        let query = this.subscriptions.select("stripe_customer_id, status").in("status", statuses);
        if (part) query = query.in("stripe_customer_id", part);
        return query.order("stripe_subscription_id").range(from, to);
      });
    return customerIds ? inChunks(customerIds, read) : read();
  }

  async stripeSubscriptionRows() {
    return fetchAllRows<StripeSubscriptionRow>((from, to) => this.subscriptions.select("*").order("stripe_subscription_id").range(from, to));
  }

  async stripeSubscriptionsWithStatus(status: string) {
    return fetchAllRows<StripeSubscriptionDetail>((from, to) =>
      this.subscriptions
          .select("stripe_subscription_id, stripe_customer_id, status, created_at_stripe, canceled_at, data")
          .eq("status", status)
          .order("stripe_subscription_id")
          .range(from, to)
    );
  }

  async stripeSubscriptionsByCustomers(stripeCustomerIds: string[]) {
    const rows = await inChunks(stripeCustomerIds, (part) =>
      fetchAllRows<StripeSubscriptionTrial & { stripe_subscription_id: string }>((from, to) =>
        this.subscriptions
            .select("stripe_subscription_id, stripe_customer_id, created_at_stripe, canceled_at, data")
            .in("stripe_customer_id", part)
            .order("stripe_subscription_id")
            .range(from, to)
      )
    );
    return sortByKey(rows, (r) => r.stripe_subscription_id).map(({ stripe_subscription_id: _id, ...trial }) => trial);
  }

  lastStripeSubscriptionImportAt() {
    return this.newest("stripe_subscriptions");
  }

  async stripeInvoices(filter: StripeBillingFilter = {}) {
    const read = (customers?: string[]) =>
      fetchAllRows<StripeInvoiceRow>((from, to) => {
        let query = this.invoices.select("*");
        if (customers) query = query.in("stripe_customer_id", customers);
        if (filter.createdFrom) query = query.gte("created_at_stripe", filter.createdFrom);
        if (filter.createdTo) query = query.lt("created_at_stripe", filter.createdTo);
        return query.order("created_at_stripe").order("stripe_invoice_id").range(from, to);
      });
    const rows = filter.customerIds ? await inChunks(filter.customerIds, read) : await read();
    return byCreatedThenId(rows, (r) => r.stripe_invoice_id);
  }

  async stripeInvoicesByCustomers(filter: StripeBillingFilter = {}) {
    return groupByCustomer(await this.stripeInvoices(filter));
  }

  async stripeCharges(filter: StripeBillingFilter = {}) {
    const read = (customers?: string[]) =>
      fetchAllRows<StripeChargeRow>((from, to) => {
        let query = this.charges.select("*");
        if (customers) query = query.in("stripe_customer_id", customers);
        if (filter.createdFrom) query = query.gte("created_at_stripe", filter.createdFrom);
        if (filter.createdTo) query = query.lt("created_at_stripe", filter.createdTo);
        return query.order("created_at_stripe").order("stripe_charge_id").range(from, to);
      });
    const rows = filter.customerIds ? await inChunks(filter.customerIds, read) : await read();
    return byCreatedThenId(rows, (r) => r.stripe_charge_id);
  }

  async stripeInvoiceIdsWithStatus(statuses: string[]) {
    const rows = await fetchAllRows<{ stripe_invoice_id: string }>((from, to) =>
      this.invoices.select("stripe_invoice_id").in("status", statuses).order("stripe_invoice_id").range(from, to)
    );
    return rows.map((r) => r.stripe_invoice_id);
  }

  async newestStripeInvoiceCreatedAt() {
    const { data, error } = await this.invoices.select("created_at_stripe").order("created_at_stripe", { ascending: false }).limit(1);
    if (error) throw new Error(error.message);
    return data?.[0]?.created_at_stripe ?? null;
  }

  async newestStripeChargeCreatedAt() {
    const { data, error } = await this.charges.select("created_at_stripe").order("created_at_stripe", { ascending: false }).limit(1);
    if (error) throw new Error(error.message);
    return data?.[0]?.created_at_stripe ?? null;
  }

  async upsertKajabiContacts(rows: NewKajabiContact[]) {
    await upsertInChunks(this.contacts, rows, "kajabi_contact_id", WRITE_CHUNK);
  }

  async setKajabiContactEmail(kajabiContactId: string, email: string) {
    const { error } = await this.contacts.update({ email }).eq("kajabi_contact_id", kajabiContactId);
    if (error) throw new Error(error.message);
  }

  async kajabiContactsByEmail(email: string) {
    const { data, error } = await this.contacts.select("kajabi_contact_id, email, name").ilike("email", escapeLike(email)).order("kajabi_contact_id");
    if (error) throw new Error(error.message);
    return (data ?? []) as KajabiContactRef[];
  }

  async deleteKajabiContact(kajabiContactId: string) {
    const { error } = await this.contacts.delete().eq("kajabi_contact_id", kajabiContactId);
    if (error) throw new Error(error.message);
  }

  async upsertKajabiCustomers(rows: NewKajabiCustomer[]) {
    await upsertInChunks(this.customers, rows, "kajabi_customer_id", WRITE_CHUNK);
  }

  async upsertKajabiPurchases(rows: NewKajabiPurchase[]) {
    await upsertInChunks(this.purchases, rows, "kajabi_purchase_id", WRITE_CHUNK);
  }

  async upsertKajabiOffers(rows: NewKajabiOffer[]) {
    await upsertInChunks(this.offers, rows, "kajabi_offer_id", WRITE_CHUNK);
  }

  async insertKajabiMembers(rows: NewKajabiMember[]) {
    for (const part of chunk(rows, WRITE_CHUNK)) {
      const { error } = await this.db.schema("bronze").from("kajabi_members").insert(part);
      if (error) throw new Error(error.message);
    }
  }

  async upsertStripeCustomers(rows: NewStripeCustomer[]) {
    await upsertInChunks(this.stripeCustomerTable, rows, "stripe_customer_id", WRITE_CHUNK);
  }

  async upsertStripeProducts(rows: NewStripeProduct[]) {
    await upsertInChunks(this.products, rows, "stripe_product_id", WRITE_CHUNK);
  }

  async upsertStripeSubscriptions(rows: NewStripeSubscription[]) {
    await upsertInChunks(this.subscriptions, rows, "stripe_subscription_id", WRITE_CHUNK);
  }

  async upsertStripeInvoices(rows: NewStripeInvoice[]) {
    await upsertInChunks(this.invoices, rows, "stripe_invoice_id", WRITE_CHUNK);
  }

  async upsertStripeCharges(rows: NewStripeCharge[]) {
    await upsertInChunks(this.charges, rows, "stripe_charge_id", WRITE_CHUNK);
  }

  async upsertSubscriptionHistory(rows: NewSubscriptionHistory[]) {
    let written = 0;
    for (const part of chunk(rows, WRITE_CHUNK)) {
      const { data, error } = await this.db
        .schema("bronze")
        .from("subscription_history")
        .upsert(part, { onConflict: "kajabi_subscription_id,imported_at" })
        .select("id");
      if (error) throw new Error(error.message);
      written += data?.length ?? 0;
    }
    return written;
  }
}

const PURCHASE_SUMMARY_COLUMNS =
  "kajabi_purchase_id, kajabi_customer_id, kajabi_offer_id, status, amount_in_cents, created_at_kajabi, effective_start_at, deactivated_at";

/** Oldest created first, a purchase with no creation time last (as the database orders ascending), then by id. */
function byCreated(rows: KajabiPurchaseSummary[]): KajabiPurchaseSummary[] {
  return [...rows].sort((a, b) => {
    if (a.created_at_kajabi !== b.created_at_kajabi) {
      if (a.created_at_kajabi === null) return 1;
      if (b.created_at_kajabi === null) return -1;
      return a.created_at_kajabi < b.created_at_kajabi ? -1 : 1;
    }
    return a.kajabi_purchase_id < b.kajabi_purchase_id ? -1 : a.kajabi_purchase_id > b.kajabi_purchase_id ? 1 : 0;
  });
}

/** In-memory twin over an `InMemoryDataset`. */
export class InMemoryBillingRepository implements BillingRepository {
  constructor(private readonly dataset: InMemoryDataset) {}

  private contactRows(): KajabiContactRow[] {
    return this.dataset.kajabiContacts.map((s) => ({
      id: s.kajabi_contact_id,
      email: "",
      name: null,
      data: {},
      created_at_kajabi: null,
      updated_at_kajabi: null,
      imported_at: EPOCH,
      updated_at: EPOCH,
      ...s,
    }));
  }

  private customerRows(): KajabiCustomerRow[] {
    return this.dataset.kajabiCustomers.map((s) => ({
      id: s.kajabi_customer_id,
      name: null,
      data: {},
      created_at_kajabi: null,
      updated_at_kajabi: null,
      imported_at: EPOCH,
      updated_at: EPOCH,
      ...s,
    }));
  }

  private purchaseRows(): KajabiPurchaseRow[] {
    return this.dataset.kajabiPurchases.map((s) => ({
      id: s.kajabi_purchase_id,
      kajabi_customer_id: null,
      kajabi_offer_id: null,
      amount_in_cents: null,
      currency: null,
      status: null,
      data: {},
      created_at_kajabi: null,
      effective_start_at: null,
      deactivated_at: null,
      imported_at: EPOCH,
      updated_at: EPOCH,
      ...s,
    }));
  }

  private offerRows(): KajabiOfferRow[] {
    return this.dataset.kajabiOffers.map((s) => ({
      id: s.kajabi_offer_id,
      name: null,
      status: null,
      trial_period_days: null,
      data: {},
      imported_at: EPOCH,
      updated_at: EPOCH,
      ...s,
    }));
  }

  private stripeCustomerRows(): StripeCustomerRow[] {
    return this.dataset.stripeCustomers.map((s) => ({
      id: s.stripe_customer_id,
      email: null,
      name: null,
      data: {},
      created_at_stripe: null,
      imported_at: EPOCH,
      updated_at: EPOCH,
      ...s,
    }));
  }

  private subscriptionRows(): StripeSubscriptionRow[] {
    return this.dataset.stripeSubscriptions.map((s) => ({
      id: s.stripe_subscription_id,
      status: "active",
      data: {},
      canceled_at: null,
      created_at_stripe: null,
      current_period_end: null,
      current_period_start: null,
      pause_collection: null,
      imported_at: EPOCH,
      updated_at: EPOCH,
      ...s,
    }));
  }

  private invoiceRows(): StripeInvoiceRow[] {
    return this.dataset.stripeInvoices.map((s) => ({
      id: s.stripe_invoice_id,
      stripe_subscription_id: null,
      status: "paid",
      billing_reason: null,
      collection_method: null,
      currency: null,
      amount_due: 0,
      amount_paid: 0,
      amount_remaining: 0,
      attempt_count: 0,
      created_at_stripe: EPOCH,
      period_start: null,
      period_end: null,
      due_date: null,
      paid_at: null,
      next_payment_attempt: null,
      stripe_charge_id: null,
      stripe_product_id: null,
      description: null,
      paid_out_of_band: false,
      imported_at: EPOCH,
      updated_at: EPOCH,
      ...s,
    }));
  }

  private chargeRows(): StripeChargeRow[] {
    return this.dataset.stripeCharges.map((s) => ({
      id: s.stripe_charge_id,
      stripe_customer_id: null,
      stripe_invoice_id: null,
      amount: 0,
      amount_refunded: 0,
      currency: null,
      status: "succeeded",
      paid: true,
      refunded: false,
      disputed: false,
      created_at_stripe: EPOCH,
      failure_code: null,
      description: null,
      imported_at: EPOCH,
      updated_at: EPOCH,
      ...s,
    }));
  }

  private newest(times: string[]): string | null {
    return times.length === 0 ? null : times.reduce((a, b) => (a > b ? a : b));
  }

  async kajabiContacts() {
    return sortByKey(this.contactRows(), (r) => r.kajabi_contact_id).map(({ kajabi_contact_id, email, name }) => ({ kajabi_contact_id, email, name }));
  }

  async kajabiContactRows() {
    return sortByKey(this.contactRows(), (r) => r.kajabi_contact_id);
  }

  async kajabiContactData(kajabiContactId: string) {
    return this.contactRows().find((r) => r.kajabi_contact_id === kajabiContactId)?.data ?? null;
  }

  async lastKajabiContactImportAt() {
    return this.newest(this.contactRows().map((r) => r.imported_at));
  }

  async kajabiCustomers(filter?: KajabiCustomerFilter) {
    const emails = filter?.emails && new Set(filter.emails);
    const ids = filter?.customerIds && new Set(filter.customerIds);
    return sortByKey(this.customerRows(), (r) => r.kajabi_customer_id)
      .filter((c) => (!emails || emails.has(c.email)) && (!ids || ids.has(c.kajabi_customer_id)))
      .map(({ kajabi_customer_id, email }) => ({ kajabi_customer_id, email }));
  }

  async kajabiCustomerRows() {
    return sortByKey(this.customerRows(), (r) => r.kajabi_customer_id);
  }

  async kajabiCustomerProfilesByEmail(emails: string[]) {
    const wanted = new Set(emails);
    return sortByKey(this.customerRows(), (r) => r.kajabi_customer_id)
      .filter((c) => wanted.has(c.email))
      .map(({ data, updated_at_kajabi }) => ({ data, updated_at_kajabi }));
  }

  async kajabiOfferRows() {
    return sortByKey(this.offerRows(), (r) => r.kajabi_offer_id);
  }

  async kajabiOfferNames() {
    return [...new Set(this.offerRows().map((o) => o.name).filter((n): n is string => !!n))].sort((a, b) => a.localeCompare(b));
  }

  async kajabiOffersByName(names: string[]) {
    const wanted = new Set(names);
    return sortByKey(this.offerRows(), (r) => r.kajabi_offer_id)
      .filter((o) => o.name !== null && wanted.has(o.name))
      .map(({ kajabi_offer_id, name }) => ({ kajabi_offer_id, name }));
  }

  async kajabiOffersByIds(offerIds: string[]) {
    const wanted = new Set(offerIds);
    return sortByKey(this.offerRows(), (r) => r.kajabi_offer_id)
      .filter((o) => wanted.has(o.kajabi_offer_id))
      .map(({ kajabi_offer_id, name, data, trial_period_days }) => ({ kajabi_offer_id, name, data, trial_period_days }));
  }

  async kajabiPurchaseRows({ offerIds, stillActive = false }: { offerIds?: string[]; stillActive?: boolean } = {}) {
    const wanted = offerIds && new Set(offerIds);
    return sortByKey(this.purchaseRows(), (r) => r.kajabi_purchase_id).filter(
      (p) => (!wanted || (p.kajabi_offer_id !== null && wanted.has(p.kajabi_offer_id))) && (!stillActive || p.deactivated_at === null)
    );
  }

  async kajabiPurchases({ offerIds, createdSince }: { offerIds?: string[]; createdSince?: string } = {}) {
    const wanted = offerIds && new Set(offerIds);
    return sortByKey(this.purchaseRows(), (r) => r.kajabi_purchase_id)
      .filter(
        (p) =>
          (!wanted || (p.kajabi_offer_id !== null && wanted.has(p.kajabi_offer_id))) &&
          (!createdSince || (p.created_at_kajabi !== null && Date.parse(p.created_at_kajabi) >= Date.parse(createdSince)))
      )
      .map(summary);
  }

  async kajabiPurchasesByCustomers(customerIds: string[]) {
    const wanted = new Set(customerIds);
    return byCreated(this.purchaseRows().filter((p) => p.kajabi_customer_id !== null && wanted.has(p.kajabi_customer_id)).map(summary));
  }

  async activeKajabiPurchaseCustomerIds(customerIds?: string[]) {
    const wanted = customerIds && new Set(customerIds);
    return new Set(
      this.purchaseRows()
        .filter((p) => p.status === "active" && p.kajabi_customer_id !== null && (!wanted || wanted.has(p.kajabi_customer_id)))
        .map((p) => p.kajabi_customer_id as string)
    );
  }

  async lastKajabiPurchaseImportAt() {
    return this.newest(this.purchaseRows().map((r) => r.imported_at));
  }

  async stripeCustomers({ emails }: { emails?: string[] } = {}) {
    const wanted = emails && new Set(emails);
    return sortByKey(this.stripeCustomerRows(), (r) => r.stripe_customer_id)
      .filter((c) => !wanted || (c.email !== null && wanted.has(c.email)))
      .map(({ stripe_customer_id, email, name, created_at_stripe }) => ({ stripe_customer_id, email, name, created_at_stripe }));
  }

  async stripeCustomersWithData() {
    return sortByKey(this.stripeCustomerRows(), (r) => r.stripe_customer_id).map(({ stripe_customer_id, email, data }) => ({ stripe_customer_id, email, data }));
  }

  async stripeProductsByName(names: string[]) {
    const wanted = new Set(names);
    return sortByKey(this.dataset.stripeProducts, (r) => r.stripe_product_id)
      .filter((p) => wanted.has(p.name))
      .map(({ stripe_product_id, name }) => ({ stripe_product_id, name }));
  }

  async stripeSubscriptionStatuses(statuses: string[], customerIds?: string[]) {
    const wantedStatuses = new Set(statuses);
    const wantedCustomers = customerIds && new Set(customerIds);
    return sortByKey(this.subscriptionRows(), (r) => r.stripe_subscription_id)
      .filter((s) => wantedStatuses.has(s.status) && (!wantedCustomers || wantedCustomers.has(s.stripe_customer_id)))
      .map(({ stripe_customer_id, status }) => ({ stripe_customer_id, status }));
  }

  async stripeSubscriptionRows() {
    return sortByKey(this.subscriptionRows(), (r) => r.stripe_subscription_id);
  }

  async stripeSubscriptionsWithStatus(status: string) {
    return sortByKey(this.subscriptionRows(), (r) => r.stripe_subscription_id)
      .filter((s) => s.status === status)
      .map(({ stripe_subscription_id, stripe_customer_id, status, created_at_stripe, canceled_at, data }) => ({
        stripe_subscription_id,
        stripe_customer_id,
        status,
        created_at_stripe,
        canceled_at,
        data,
      }));
  }

  async stripeSubscriptionsByCustomers(stripeCustomerIds: string[]) {
    const wanted = new Set(stripeCustomerIds);
    return sortByKey(this.subscriptionRows(), (r) => r.stripe_subscription_id)
      .filter((s) => wanted.has(s.stripe_customer_id))
      .map(({ stripe_customer_id, created_at_stripe, canceled_at, data }) => ({ stripe_customer_id, created_at_stripe, canceled_at, data }));
  }

  async lastStripeSubscriptionImportAt() {
    return this.newest(this.subscriptionRows().map((r) => r.imported_at));
  }

  /** Adds each row, or merges it into the stored row with the same key (a column left out keeps its value, as in SQL). */
  private upsert<T extends object>(stored: T[], rows: T[], same: (a: T, b: T) => boolean) {
    for (const row of rows) {
      const existing = stored.find((s) => same(s, row));
      if (existing) Object.assign(existing, row);
      else stored.push({ ...row });
    }
  }

  async upsertKajabiContacts(rows: NewKajabiContact[]) {
    this.upsert(this.dataset.kajabiContacts, rows, (a, b) => a.kajabi_contact_id === b.kajabi_contact_id);
  }

  async setKajabiContactEmail(kajabiContactId: string, email: string) {
    for (const c of this.dataset.kajabiContacts) if (c.kajabi_contact_id === kajabiContactId) c.email = email;
  }

  async kajabiContactsByEmail(email: string) {
    return this.dataset.kajabiContacts
      .filter((c) => c.email?.toLowerCase() === email.toLowerCase())
      .map((c) => ({ kajabi_contact_id: c.kajabi_contact_id, email: c.email ?? null, name: c.name ?? null }) as KajabiContactRef)
      .sort((a, b) => (a.kajabi_contact_id < b.kajabi_contact_id ? -1 : 1));
  }

  async deleteKajabiContact(kajabiContactId: string) {
    this.dataset.kajabiContacts = this.dataset.kajabiContacts.filter((c) => c.kajabi_contact_id !== kajabiContactId);
  }

  async upsertKajabiCustomers(rows: NewKajabiCustomer[]) {
    this.upsert(this.dataset.kajabiCustomers, rows, (a, b) => a.kajabi_customer_id === b.kajabi_customer_id);
  }

  async upsertKajabiPurchases(rows: NewKajabiPurchase[]) {
    this.upsert(this.dataset.kajabiPurchases, rows, (a, b) => a.kajabi_purchase_id === b.kajabi_purchase_id);
  }

  async upsertKajabiOffers(rows: NewKajabiOffer[]) {
    this.upsert(this.dataset.kajabiOffers, rows, (a, b) => a.kajabi_offer_id === b.kajabi_offer_id);
  }

  async insertKajabiMembers(rows: NewKajabiMember[]) {
    this.dataset.kajabiMembers.push(...rows.map((r) => ({ ...r })));
  }

  async upsertStripeCustomers(rows: NewStripeCustomer[]) {
    this.upsert(this.dataset.stripeCustomers, rows, (a, b) => a.stripe_customer_id === b.stripe_customer_id);
  }

  async upsertStripeProducts(rows: NewStripeProduct[]) {
    this.upsert(this.dataset.stripeProducts, rows, (a, b) => a.stripe_product_id === b.stripe_product_id);
  }

  async upsertStripeSubscriptions(rows: NewStripeSubscription[]) {
    this.upsert(this.dataset.stripeSubscriptions, rows, (a, b) => a.stripe_subscription_id === b.stripe_subscription_id);
  }

  async upsertStripeInvoices(rows: NewStripeInvoice[]) {
    this.upsert(this.dataset.stripeInvoices, rows, (a, b) => a.stripe_invoice_id === b.stripe_invoice_id);
  }

  async upsertStripeCharges(rows: NewStripeCharge[]) {
    this.upsert(this.dataset.stripeCharges, rows, (a, b) => a.stripe_charge_id === b.stripe_charge_id);
  }

  async stripeInvoices(filter: StripeBillingFilter = {}) {
    const customers = filter.customerIds && new Set(filter.customerIds);
    return byCreatedThenId(
      this.invoiceRows().filter((r) => (!customers || customers.has(r.stripe_customer_id)) && inRange(r.created_at_stripe, filter)),
      (r) => r.stripe_invoice_id
    );
  }

  async stripeInvoicesByCustomers(filter: StripeBillingFilter = {}) {
    return groupByCustomer(await this.stripeInvoices(filter));
  }

  async stripeCharges(filter: StripeBillingFilter = {}) {
    const customers = filter.customerIds && new Set(filter.customerIds);
    return byCreatedThenId(
      this.chargeRows().filter((r) => (!customers || (r.stripe_customer_id !== null && customers.has(r.stripe_customer_id))) && inRange(r.created_at_stripe, filter)),
      (r) => r.stripe_charge_id
    );
  }

  async stripeInvoiceIdsWithStatus(statuses: string[]) {
    const wanted = new Set(statuses);
    return this.invoiceRows()
      .filter((r) => wanted.has(r.status))
      .map((r) => r.stripe_invoice_id)
      .sort();
  }

  async newestStripeInvoiceCreatedAt() {
    return this.newest(this.invoiceRows().map((r) => r.created_at_stripe));
  }

  async newestStripeChargeCreatedAt() {
    return this.newest(this.chargeRows().map((r) => r.created_at_stripe));
  }

  async upsertSubscriptionHistory(rows: NewSubscriptionHistory[]) {
    this.upsert(this.dataset.subscriptionHistory, rows, (a, b) => a.kajabi_subscription_id === b.kajabi_subscription_id && a.imported_at === b.imported_at);
    return rows.length;
  }
}

/** Oldest created first, then by Stripe id, so the order is the database's (`created_at_stripe`, id) whatever the input order. */
function byCreatedThenId<T extends { created_at_stripe: string }>(rows: T[], id: (row: T) => string): T[] {
  return [...rows].sort((a, b) => {
    const at = Date.parse(a.created_at_stripe);
    const bt = Date.parse(b.created_at_stripe);
    if (at !== bt) return at < bt ? -1 : 1;
    return id(a) < id(b) ? -1 : id(a) > id(b) ? 1 : 0;
  });
}

function inRange(createdAt: string, { createdFrom, createdTo }: StripeBillingFilter): boolean {
  const at = Date.parse(createdAt);
  return (!createdFrom || at >= Date.parse(createdFrom)) && (!createdTo || at < Date.parse(createdTo));
}

function groupByCustomer(rows: StripeInvoiceRow[]): Map<string, StripeInvoiceRow[]> {
  const byCustomer = new Map<string, StripeInvoiceRow[]>();
  for (const row of rows) {
    const list = byCustomer.get(row.stripe_customer_id);
    if (list) list.push(row);
    else byCustomer.set(row.stripe_customer_id, [row]);
  }
  return byCustomer;
}

function summary(p: KajabiPurchaseRow): KajabiPurchaseSummary {
  const { kajabi_purchase_id, kajabi_customer_id, kajabi_offer_id, status, amount_in_cents, created_at_kajabi, effective_start_at, deactivated_at } = p;
  return { kajabi_purchase_id, kajabi_customer_id, kajabi_offer_id, status, amount_in_cents, created_at_kajabi, effective_start_at, deactivated_at };
}
