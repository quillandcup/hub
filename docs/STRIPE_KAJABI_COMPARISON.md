# Stripe vs Kajabi Subscription Comparison Report

**Generated:** 2026-04-29

## Executive Summary

| Metric | Count |
|--------|-------|
| **Stripe Total Subscriptions** | 98 |
| Stripe Truly Active (paying) | 69 |
| Stripe Paused (on hiatus) | 27 |
| Stripe Past Due | 2 |
| **Kajabi Active Subscriptions** | 81 |
| **Discrepancy** | 12 fewer in Stripe |

## Key Findings

### 1. Matching Strategy
- **Email matching is unreliable** - 8 customers use different emails in Stripe vs Kajabi
- **Correct approach:** Use `kjb_member_id` stored in Stripe customer metadata
- All 98 Stripe subscriptions have `kjb_member_id` linking to Kajabi customers

### 2. Email Mismatches (5 customers)
These customers have different emails in Stripe vs Kajabi but are the same person:

| Stripe Email | Kajabi Email | Name |
|--------------|--------------|------|
| member25@example.com | member25b@example.com | Member 25 |
| member26@example.com | member26b@example.com | Member 26 |
| member27@example.com | member27b@example.com | Member 27 |
| member28@example.com | member28b@example.com | Member 28 |
| member3b@example.com | member3@example.com | Member 3 |

### 3. Manual Stripe Subscriptions (2 customers)
Ania created these manually in Stripe after 180 program, but no Kajabi purchase record:

| Email | Name | Created | Status |
|-------|------|---------|--------|
| member29@example.com | Member 29 | 2026-04-06 | Active in Stripe only |
| member30@example.com | Member 30 | 2026-04-11 | Active in Stripe only |

### 4. Status Mismatches: Kajabi Active but Stripe Not Paying (17 customers)

#### a) Paused/On Hiatus (10 customers)
Stripe shows `pause_collection` set (not being billed), but Kajabi shows active:

| Email | Name | Offer |
|-------|------|-------|
| member31@example.com | Member 31 | Quill & Cup Membership |
| member8@example.com | Member 8 | Quill & Cup Membership |
| member1@example.com | Member 1 | Yes, girl! I see you! |
| member2@example.com | Member 2 | Yes, girl! I see you! |
| member32@example.com | Member 32 | Quill & Cup Membership |
| member7@example.com | Member 7 | Yes, girl! I see you! |
| member3@example.com | Member 3 | Quill & Cup Membership |
| member4@example.com | Member 4 | Quill & Cup Membership |
| member5@example.com | Member 5 | Yes, girl! I see you! |
| member41@example.com | Member 41 | Yes, girl! I see you! |

#### b) Past Due (2 customers)
Payment failed, but Kajabi still shows active:

| Email | Name | Offer |
|-------|------|-------|
| member33@example.com | Member 33 | Quill & Cup Membership |
| member34@example.com | Member 34 | Quill & Cup Membership |

#### c) No Stripe Subscription (5 customers)
Active in Kajabi but no matching Stripe subscription at all:

| Email | Name | Offer |
|-------|------|-------|
| member35@example.com | Member 35 | Yes, girl! I see you! |
| member36@example.com | Member 36 | Yes, girl! I see you! |
| member17@example.com | Member 17 | Yes, girl! I see you! |
| member37@example.com | Member 37 | Yes, girl! I see you! |
| member37b@example.com | Member 37 | Yes, girl! I see you! |

**Note:** Member 37 appears twice - possible duplicate Kajabi accounts?

### 5. Status Mismatches: Stripe Active but Kajabi Canceled (27 customers)
These have active Stripe subscriptions but Kajabi shows `deactivated_at` set. Sample:

| Email | Name | Stripe Status | Kajabi Deactivated | Notes |
|-------|------|---------------|-------------------|-------|
| member25@example.com | Member 25 | active (paused) | 2026-04-13 | On hiatus |
| member38@example.com | Member 38 | active | 2026-03-09 | Canceled in Kajabi |
| member39@example.com | Member 39 | active (paused) | 2026-03-06 | On hiatus |
| member40@example.com | Member 40 | active (paused) | 2026-02-23 | On hiatus |
| member27@example.com | Member 27 | active (paused) | 2026-02-01 | On hiatus |

Full list: 27 subscriptions still billing in Stripe despite being canceled in Kajabi.

## Recommendations

### Immediate Actions
1. **Reconcile the 5 with no Stripe subscription:**
   - Verify these aren't paying through a different method
   - Consider deactivating in Kajabi if no active payment source

2. **Review the 2 past due subscriptions:**
   - Reach out to customers about failed payments
   - Consider pausing or canceling Kajabi access if payment not resolved

3. **Update member processing logic:**
   - Use Stripe as source of truth for subscription status
   - Match by `kjb_member_id` instead of email
   - Status determination:
     - **Active**: Stripe status='active' AND pause_collection IS NULL
     - **Paused**: Stripe status='active' AND pause_collection IS NOT NULL  
     - **Past Due**: Stripe status='past_due'
     - **Inactive**: No Stripe subscription OR Stripe status='canceled'

### Data Quality
1. **Email standardization:**
   - Document that Stripe email may differ from Kajabi email
   - Always use `kjb_member_id` for matching

2. **Manual subscription tracking:**
   - Document the 2 manual Stripe subscriptions (Abby, Diana)
   - Create Kajabi purchase records for them, or
   - Track separately as "Stripe-only" members

## Technical Implementation

### Current State
- Kajabi API doesn't expose paused/past_due status
- Email-based matching misses 8 subscriptions
- Member status logic only checks `deactivated_at` in Kajabi

### Proposed Changes
1. Update `/api/process/members` to:
   - Join Stripe subscriptions by `kjb_member_id`
   - Use Stripe status + pause_collection for member status
   - Handle edge cases (no Stripe subscription, multiple subscriptions, etc.)

2. Create reconciliation dashboard showing:
   - Status mismatches between systems
   - Members paying in Stripe but not active in Kajabi
   - Members active in Kajabi but not paying in Stripe

## Appendix: Comparison Methodology

### Data Sources
- **Kajabi Bronze Tables:**
  - `bronze.kajabi_customers` (299 customers)
  - `bronze.kajabi_purchases` (781 purchases)
  - `bronze.kajabi_offers` (54 offers, 2 are subscriptions)

- **Stripe Bronze Tables:**
  - `bronze.stripe_customers` (296 customers)
  - `bronze.stripe_subscriptions` (98 subscriptions)
  - `bronze.stripe_products` (18 products)

### Matching Logic
```sql
-- Join Stripe to Kajabi using kjb_member_id from metadata
SELECT *
FROM bronze.stripe_subscriptions s
JOIN bronze.stripe_customers sc ON sc.stripe_customer_id = s.stripe_customer_id
JOIN bronze.kajabi_customers kc ON kc.kajabi_customer_id = (sc.data->'metadata'->>'kjb_member_id')
```

### Status Classification
```sql
-- Stripe truly active (paying)
WHERE s.status = 'active' AND s.pause_collection IS NULL

-- Stripe paused (not being billed)
WHERE s.status = 'active' AND s.pause_collection IS NOT NULL

-- Kajabi active
WHERE p.deactivated_at IS NULL
```
