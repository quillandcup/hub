-- Bronze layer: Raw subscription data from Kajabi exports
-- Source: Kajabi "subscriptions.csv" exports
-- Purpose: Track subscription status changes over time to detect hiatus periods

create table "public"."subscription_history" (
  "id" uuid not null default gen_random_uuid(),
  "kajabi_subscription_id" text not null,
  "customer_id" text,
  "customer_name" text,
  "customer_email" text not null,
  "status" text not null, -- Active, Paused, Canceled, Pending Cancellation
  "amount" text,
  "currency" text,
  "interval" text,
  "created_at_kajabi" text, -- When subscription was created in Kajabi
  "canceled_on" text, -- When subscription was canceled
  "trial_ends_on" text,
  "next_payment_date" text,
  "offer_id" text,
  "offer_title" text,
  "provider" text, -- Stripe, etc
  "provider_id" text, -- Stripe customer ID
  "imported_at" timestamp with time zone default now(),
  "data" jsonb -- Store full row as JSON for any additional columns
);

-- Composite unique constraint: subscription can appear once per import
-- This allows us to track status changes over time by importing the CSV periodically
CREATE UNIQUE INDEX subscription_history_kajabi_id_imported_idx ON public.subscription_history
  USING btree (kajabi_subscription_id, imported_at);

CREATE INDEX idx_subscription_history_email ON public.subscription_history USING btree (customer_email);
CREATE INDEX idx_subscription_history_status ON public.subscription_history USING btree (status);
CREATE INDEX idx_subscription_history_imported_at ON public.subscription_history USING btree (imported_at);

CREATE UNIQUE INDEX subscription_history_pkey ON public.subscription_history USING btree (id);

alter table "public"."subscription_history" add constraint "subscription_history_pkey" PRIMARY KEY using index "subscription_history_pkey";

grant delete on table "public"."subscription_history" to "anon";
grant insert on table "public"."subscription_history" to "anon";
grant references on table "public"."subscription_history" to "anon";
grant select on table "public"."subscription_history" to "anon";
grant trigger on table "public"."subscription_history" to "anon";
grant truncate on table "public"."subscription_history" to "anon";
grant update on table "public"."subscription_history" to "anon";

grant delete on table "public"."subscription_history" to "authenticated";
grant insert on table "public"."subscription_history" to "authenticated";
grant references on table "public"."subscription_history" to "authenticated";
grant select on table "public"."subscription_history" to "authenticated";
grant trigger on table "public"."subscription_history" to "authenticated";
grant truncate on table "public"."subscription_history" to "authenticated";
grant update on table "public"."subscription_history" to "authenticated";

grant delete on table "public"."subscription_history" to "service_role";
grant insert on table "public"."subscription_history" to "service_role";
grant references on table "public"."subscription_history" to "service_role";
grant select on table "public"."subscription_history" to "service_role";
grant trigger on table "public"."subscription_history" to "service_role";
grant truncate on table "public"."subscription_history" to "service_role";
grant update on table "public"."subscription_history" to "service_role";
