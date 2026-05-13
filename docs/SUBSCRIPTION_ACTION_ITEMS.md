# Subscription Reconciliation Action Items

*Date:* 2026-04-30

## Immediate Actions Required

### 1. Kajabi Updates Needed

#### Reactivate in Kajabi
- *member38@example.com* (Member 38)
  - Status: Active and paying in Stripe
  - Issue: Incorrectly deactivated in Kajabi (deactivated 2026-03-09)
  - Action: Reactivate Kajabi subscription

#### Deactivate in Kajabi  
- *member31@example.com* (Member 31)
  - Status: On hiatus, correctly paused in Stripe
  - Issue: Still shows active in Kajabi
  - Action: Revoke in Kajabi too

- *member41@example.com* (Member 41)
  - Status: On hiatus, correctly paused in Stripe
  - Stripe: Paused (“Yes, girl! I see you!“)
  - Issue: Still shows as active in Kajabi
  - Action: Revoke in Kajabi too

#### Hiatus -> Cancel? 
- *member32@example.com* (Member 32)
  - Status: Permanently paused/on hiatus
  - Stripe: Paused
  - Kajabi: Active
  - Status: :warning: Verify if “permanently paused” means should be deactivated in Kajabi

### 2. Payment Method Conversions (PayPal → Stripe)

#### New Member - Recently Joined
- *member36@example.com* (Member 36)
  - Status: Just joined, using PayPal for some reason
  - Action: Convert to Stripe subscription

#### Existing Member - Using PayPal
- *member17@example.com* (Member 17)
  - Status: Using PayPal instead of Stripe
  - Action: Convert to Stripe subscription

### 3. Payments Missing/Investigation

#### Multiple Accounts - No Payments
- *member37@example.com* / *member37b@example.com* / *member37c@example.com* / *member37d@example.com* (Member 37)
  - Status: Doesn’t appear to have paid since early 2025
  - Evidence: Multiple changing cards, emails, and Kajabi/Stripe accounts
  - Current: 2 active Kajabi subscriptions (“Yes, girl! I see you!“), no Stripe subscriptions
  - Action: 
    1. Investigate payment history across all accounts
    2. Consolidate to single account
    3. Require valid payment method or deactivate
    4. Consider reaching out about payment issues

### 4. Deactivate - Member Deceased

- *member35@example.com* (Member 35)
  - Status: Active in Kajabi (“Yes, girl! I see you!“), no Stripe subscription
  - Reason: Member passed away
  - Action: Deactivate Kajabi subscription

## Context - No Action Needed (Already Handled Correctly)

### 180 Program Members (5)
These show as paused in Stripe because Q&C Membership is included via 180 program for 6 months:
- member1@example.com (Member 1)
- member2@example.com (Member 2)
- member3@example.com (Member 3)
- member4@example.com (Member 4)
- member5@example.com (Member 5)

*Status:* ✓ Correct (paused in Stripe, but getting access through 180 program)

### Special Gift/Compensation Cases

#### Mika Affiliate Compensation
- *member7@example.com* (Member 7)
  - Kajabi: Shows canceled
  - Ania says: She’s back, given “gift” to compensate for missed Mika affiliates
  - Stripe: Paused with mark_uncollectible behavior
  - Status: ✓ Needs Kajabi reactivation - when?

#### Hosting Gift
- *member8@example.com* (Member 8)
  - Status: Maybe paused for hosting (gift)
  - Stripe: Paused with mark_uncollectible behavior
  - Status: :warning: Verify if this is intentional

## Questions for Resolution

1. *Member 7*: Should her gift be time-limited or ongoing?
2. *Member 8*: Confirm hosting gift details and duration
3. *Member 32*: Does “permanently paused” mean she should be deactivated completely?
4. *PayPal Strategy*: Convert all to Stripe, or add PayPal tracking?