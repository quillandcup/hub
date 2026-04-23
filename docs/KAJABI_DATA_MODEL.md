# Kajabi Data Model Design

## Vision: Single Source of Truth

Replace Kajabi as the system of record by replicating all key data into our own database, allowing us to:
- Build custom analytics and reports
- Track member lifecycle completely
- Own our data independently
- Build custom automations
- Eventually migrate off Kajabi if needed

## Available Kajabi Exports

Based on Kajabi admin capabilities (April 2026):

### ✅ Currently Using
1. **Contacts** (`/contacts` → Export CSV)
2. **Subscriptions** (`/sales/subscriptions` → Export CSV)

### 📋 Available But Not Yet Imported
3. **Transactions** (`/sales/transactions` → Export CSV) - All payments
4. **Offers** (`/sales/offers` → Export per offer) - Offer performance and buyer data
5. **Form Submissions** (`/marketing/forms` → Export per form) - Lead capture data
6. **Product Progress** (`/analytics/product-progress` → Export Excel) - Course completion/engagement
7. **Opt-in Reports** (`/analytics/opt-ins` → Export CSV) - How users join
8. **Partner Campaigns** (`/marketing/partners` → Export CSV) - Affiliate data (if used)

### ⚠️ Not Exportable in Bulk
- Individual Landing Pages (ZIP per page)
- Website Templates (ZIP)
- Videos (download individually)
- Product Templates (ZIP per product)

## Phase 1: Core Member Data (Current)

### Tables: `members`, `kajabi_members`

**Status:** ✅ Implemented

**Data Sources:**
- Contacts CSV
- Subscriptions CSV

**Captures:**
- Member identity (name, email, IDs)
- Status (active, inactive, on_hiatus)
- Tags (Quill & Cup Member, Offboarding)
- Current products (from Products field)
- Current subscription status
- External IDs (Kajabi contact ID, Stripe customer ID)

**Limitations:**
- Products field is denormalized string (can't query by product)
- No historical tracking (when did they join/leave products?)
- No transaction history (what did they actually buy?)
- No offer details (what bundle did they purchase?)

## Phase 2: Products & Offers (Priority)

### New Tables Needed

#### `kajabi_products`
**Purpose:** Catalog of all products/programs offered

**Bronze Layer** (manual catalog - no bulk export available):
```sql
CREATE TABLE kajabi_products (
    id TEXT PRIMARY KEY, -- Manual/generated product ID
    name TEXT NOT NULL, -- "Quill & Cup Membership", "180 Program", etc.
    type TEXT NOT NULL, -- "subscription", "course", "bundle"
    description TEXT,
    pricing_model TEXT, -- "monthly", "annual", "one-time"
    active BOOLEAN DEFAULT true,
    imported_at TIMESTAMP WITH TIME ZONE NOT NULL,
    data JSONB -- Additional metadata
);
```

**Where to get this data:**
- Manual catalog from Contacts CSV "Products" field and Offer Purchases "Products" field
- Parse unique product names from existing imports

**Known Products from exports:**
```
From Contacts/Offer Purchases:
- Quill & Cup Membership
- Hedgies on First Orientation
- 180 Program (mentioned in docs)
- Mindset Training (mentioned in docs)
- Self-Editing Academy (mentioned in docs)
- BFF Program (mentioned in docs)
- Chicago Retreat (mentioned in docs)
```

#### `kajabi_offers`
**Purpose:** Specific offers/bundles that can be purchased (from Offer Purchases export)

**Bronze Layer:**
```sql
CREATE TABLE kajabi_offers (
    id TEXT PRIMARY KEY, -- Kajabi offer ID
    title TEXT NOT NULL, -- Offer title
    imported_at TIMESTAMP WITH TIME ZONE NOT NULL,
    data JSONB NOT NULL -- Full export data
);
```

**Actual CSV Fields from `/sales/offers/{offer_id}`:**
- Offer ID
- Created at
- Member ID (links to contact)
- Member name, Member email
- Opted in (boolean)
- Upsold by offer ID
- Bumped by offer ID
- Deactivated (boolean)
- Deactivated Date
- Address fields
- Instagram Handle
- Products (comma-separated)

**Known Offer IDs:**
- `2148293442` = "Yes, girl! I see you!"
- `2148128038` = "Quill & Cup Membership"

#### `kajabi_offer_purchases`
**Purpose:** Track member purchases per offer (from Offer Purchases export)

**Bronze Layer:**
```sql
CREATE TABLE kajabi_offer_purchases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    offer_id TEXT NOT NULL,
    member_id TEXT NOT NULL, -- Kajabi member ID
    member_email TEXT NOT NULL,
    member_name TEXT,
    products TEXT, -- Comma-separated product names
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    opted_in BOOLEAN,
    upsold_by_offer_id TEXT,
    bumped_by_offer_id TEXT,
    deactivated BOOLEAN,
    deactivated_date TIMESTAMP WITH TIME ZONE,
    instagram_handle TEXT,
    imported_at TIMESTAMP WITH TIME ZONE NOT NULL,
    data JSONB NOT NULL -- Full row data
);

CREATE INDEX idx_offer_purchases_member_id ON kajabi_offer_purchases(member_id);
CREATE INDEX idx_offer_purchases_member_email ON kajabi_offer_purchases(member_email);
CREATE INDEX idx_offer_purchases_offer_id ON kajabi_offer_purchases(offer_id);
```

#### `member_products`
**Purpose:** Junction table tracking which products each member has/had (derived from Contacts + Offer Purchases)

**Silver Layer** (derived):
```sql
CREATE TABLE member_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    product_name TEXT NOT NULL, -- Product name (will normalize to product_id later)
    access_granted_at TIMESTAMP WITH TIME ZONE NOT NULL,
    access_revoked_at TIMESTAMP WITH TIME ZONE, -- From Offer Purchases deactivated_date
    source TEXT NOT NULL, -- 'offer_purchase', 'contacts_csv'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX idx_member_products_member_id ON member_products(member_id);
CREATE INDEX idx_member_products_product_name ON member_products(product_name);
CREATE INDEX idx_member_products_active ON member_products(member_id, access_revoked_at) 
    WHERE access_revoked_at IS NULL;
```

**Data sources:**
- Contacts CSV "Products" field (current products)
- Offer Purchases CSV (historical purchases with deactivation dates)

**Enables queries like:**
- "Which members have the 180 Program?"
- "When did this member join BFF Program?"
- "What products has this member purchased historically?"

## Phase 3: Transactions (Financial History)

### New Tables Needed

#### `kajabi_transactions`
**Purpose:** All payments and refunds

**Bronze Layer:**
```sql
CREATE TABLE kajabi_transactions (
    id TEXT PRIMARY KEY, -- Kajabi transaction ID
    customer_id TEXT NOT NULL, -- Kajabi contact ID
    customer_name TEXT,
    customer_email TEXT NOT NULL,
    amount NUMERIC(10, 2) NOT NULL,
    currency TEXT NOT NULL,
    type TEXT NOT NULL, -- 'subscription', 'one-time', etc.
    payment_method TEXT, -- 'stripe', etc.
    status TEXT NOT NULL, -- 'succeeded', 'failed'
    failure_message TEXT,
    offer_id TEXT,
    offer_title TEXT,
    pricing_option TEXT,
    order_no TEXT,
    provider TEXT, -- 'Stripe'
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    coupon_used TEXT,
    -- Address fields
    address TEXT,
    address_2 TEXT,
    city TEXT,
    country TEXT,
    state TEXT,
    zipcode TEXT,
    phone TEXT,
    -- Tax fields
    tax_name TEXT,
    tax_rate NUMERIC(10, 4),
    tax_amount NUMERIC(10, 2),
    additional_tax_name TEXT,
    additional_tax_rate NUMERIC(10, 4),
    additional_tax_amount NUMERIC(10, 2),
    -- Card details
    card_postal_code TEXT,
    card_country TEXT,
    card_brand TEXT,
    card_funding TEXT,
    -- Other
    quantity INTEGER,
    charge_attempt INTEGER,
    invoice_id TEXT,
    receipt_id TEXT,
    imported_at TIMESTAMP WITH TIME ZONE NOT NULL,
    data JSONB NOT NULL -- Full row data
);

CREATE INDEX idx_transactions_customer_id ON kajabi_transactions(customer_id);
CREATE INDEX idx_transactions_customer_email ON kajabi_transactions(customer_email);
CREATE INDEX idx_transactions_created_at ON kajabi_transactions(created_at);
CREATE INDEX idx_transactions_status ON kajabi_transactions(status);
CREATE INDEX idx_transactions_offer_id ON kajabi_transactions(offer_id);
```

**Actual CSV Fields from `/sales/transactions`:**
- ID, Amount, Currency, Type, Payment Method
- Customer ID, Customer Name, Customer Email
- Offer ID, Offer Title, Pricing Option
- Order No., Provider, Created At
- Coupon Used
- Address, Address 2, City, Country, State, Zipcode, Phone
- Tax Name, Tax Rate, Tax Amount
- Additional Tax Name, Additional Tax Rate, Additional Tax Amount
- Quantity, Status, Failure Message, Charge Attempt
- Card Postal Code, Card Country, Card Brand, Card Funding
- Invoice ID, Receipt ID

**Enables:**
- Lifetime value (LTV) calculations
- Revenue reporting
- Refund/failure tracking
- Payment history per member
- Tax reporting

## Phase 4: Lead Tracking

### New Tables Needed

#### `kajabi_form_submissions`
**Purpose:** Track how people enter the funnel

**Bronze Layer:**
```sql
CREATE TABLE kajabi_form_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    form_id TEXT NOT NULL, -- Which lead capture form
    form_name TEXT NOT NULL,
    email TEXT NOT NULL,
    name TEXT,
    submitted_at TIMESTAMP WITH TIME ZONE NOT NULL,
    imported_at TIMESTAMP WITH TIME ZONE NOT NULL,
    data JSONB NOT NULL -- All form fields
);

CREATE INDEX idx_form_submissions_email ON kajabi_form_submissions(email);
CREATE INDEX idx_form_submissions_form ON kajabi_form_submissions(form_id);
```

**Where to get this data:**
- Marketing → Forms → Submissions → Export per form

**Enables:**
- Lead source tracking
- Conversion funnel analysis
- "How did this member find us?"

## Phase 5: Engagement Tracking

### New Tables Needed

#### `kajabi_product_progress`
**Purpose:** Course completion and engagement

**Bronze Layer:**
```sql
CREATE TABLE kajabi_product_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    completion_percentage INTEGER, -- 0-100
    last_activity_at TIMESTAMP WITH TIME ZONE,
    lessons_completed INTEGER,
    total_lessons INTEGER,
    imported_at TIMESTAMP WITH TIME ZONE NOT NULL,
    data JSONB NOT NULL
);

CREATE INDEX idx_product_progress_contact ON kajabi_product_progress(contact_id);
CREATE INDEX idx_product_progress_product ON kajabi_product_progress(product_id);
```

**Where to get this data:**
- Analytics → Product Progress → Export Excel

**Enables:**
- Course completion rates
- Engagement scoring (beyond just Prickle attendance)
- Student success tracking

## Implementation Priority

### Phase 1: Foundation (✅ Done)
- Contacts import
- Subscriptions import
- Basic member status

### Phase 2A: Products Catalog (Next - Manual)
**Why:** Need to normalize product data
**Effort:** Low (manual catalog of ~10 products)
**Impact:** High (enables product-based queries)

**Tasks:**
1. Create `kajabi_products` table
2. Manually seed known products
3. Create `member_products` table
4. Update member processing to parse Products field → populate member_products

### Phase 2B: Offers Import (Next - Automated)
**Why:** Understand what bundles/offers exist
**Effort:** Medium (add to scraper)
**Impact:** Medium (helps understand purchase patterns)

**Tasks:**
1. Create `kajabi_offers` table
2. Add Offers export to scraper
3. Link offers to products

### Phase 3: Transactions Import (High Value)
**Why:** Financial history, LTV calculations
**Effort:** Medium (add to scraper)
**Impact:** High (revenue analytics)

**Tasks:**
1. Create `kajabi_transactions` table
2. Add Transactions export to scraper
3. Build revenue dashboards

### Phase 4: Lead Tracking (Medium Priority)
**Why:** Understand lead sources
**Effort:** Medium-High (multiple form exports)
**Impact:** Medium (nice to have)

### Phase 5: Engagement Tracking (Lower Priority)
**Why:** Course completion (if offering courses)
**Effort:** Medium
**Impact:** Medium (only if courses are core to business)

## Scraper Implementation Plan

### Exports to Scrape (Prioritized)

**Phase 1 (MVP - Current Manual):**
1. ✅ Contacts CSV (`/contacts` → Export CSV)
2. ✅ Subscriptions CSV (`/sales/subscriptions` → Export CSV)

**Phase 2 (Next iteration - Automated):**
3. Transactions CSV (`/sales/transactions` → Export CSV)
   - All payment history with comprehensive details
4. Offer Purchases CSV (`/sales/offers/{offer_id}` → Export CSV per offer)
   - Historical product access with deactivation dates
   - Need to loop through all offer IDs (from Subscriptions/Transactions)

**Phase 3 (Future - Lead & Engagement):**
5. Form Submissions (`/marketing/forms/{form_id}` → Export CSV per form)
6. Product Progress (`/analytics/product-progress` → Export Excel)
7. Opt-in Reports (`/analytics/opt-ins` → Export CSV)

### Playwright Script Structure

```typescript
async function exportKajabiData() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  // 1. Login
  await loginToKajabi(page);
  
  // 2. Export Contacts (Phase 1)
  await exportContacts(page);
  
  // 3. Export Subscriptions (Phase 1)
  await exportSubscriptions(page);
  
  // 4. Export Transactions (Phase 2)
  await exportTransactions(page);
  
  // 5. Export Offers (Phase 2)
  const offerIds = await getOfferIds(page);
  for (const offerId of offerIds) {
    await exportOffer(page, offerId);
  }
  
  // 6. Future: Forms, Progress, etc.
  
  await browser.close();
}
```

## Next Steps

1. **Immediate:** Design products catalog (manual list)
2. **This week:** Create `kajabi_products` and `member_products` tables
3. **Next week:** Build Playwright scraper for Contacts + Subscriptions (replicate current manual process)
4. **Week after:** Add Transactions and Offers to scraper
5. **Month 2:** Add lead tracking and engagement data

## Success Metrics

**Phase 1 (Current):**
- ✅ Can identify active/inactive/hiatus members
- ✅ Can track Prickle attendance

**Phase 2 (Products):**
- Can query "All members with 180 Program"
- Can see product history per member
- Can track when members join/leave programs

**Phase 3 (Transactions):**
- Can calculate LTV per member
- Can track revenue by product
- Can see refund rates

**Ultimate Goal:**
- Kajabi becomes just a delivery platform
- Our system is the source of truth
- Can build any custom report/analysis we need
- Can eventually migrate to different platform without data loss
