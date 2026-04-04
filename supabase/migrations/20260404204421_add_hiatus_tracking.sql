alter table "public"."members" drop constraint "members_status_check";


  create table "public"."member_hiatus_history" (
    "id" uuid not null default gen_random_uuid(),
    "member_id" uuid not null,
    "start_date" date not null,
    "end_date" date,
    "reason" text,
    "notes" text,
    "created_at" timestamp with time zone default now()
      );


alter table "public"."members" add column "hiatus_end_date" date;

alter table "public"."members" add column "hiatus_reason" text;

alter table "public"."members" add column "hiatus_start_date" date;

CREATE INDEX idx_hiatus_dates ON public.member_hiatus_history USING btree (start_date, end_date);

CREATE INDEX idx_hiatus_member_id ON public.member_hiatus_history USING btree (member_id);

CREATE INDEX idx_members_hiatus_end ON public.members USING btree (hiatus_end_date) WHERE (hiatus_end_date IS NOT NULL);

CREATE UNIQUE INDEX member_hiatus_history_pkey ON public.member_hiatus_history USING btree (id);

alter table "public"."member_hiatus_history" add constraint "member_hiatus_history_pkey" PRIMARY KEY using index "member_hiatus_history_pkey";

alter table "public"."member_hiatus_history" add constraint "member_hiatus_history_member_id_fkey" FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE not valid;

alter table "public"."member_hiatus_history" validate constraint "member_hiatus_history_member_id_fkey";

alter table "public"."members" add constraint "members_status_check" CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text, 'on_hiatus'::text]))) not valid;

alter table "public"."members" validate constraint "members_status_check";

grant delete on table "public"."member_hiatus_history" to "anon";

grant insert on table "public"."member_hiatus_history" to "anon";

grant references on table "public"."member_hiatus_history" to "anon";

grant select on table "public"."member_hiatus_history" to "anon";

grant trigger on table "public"."member_hiatus_history" to "anon";

grant truncate on table "public"."member_hiatus_history" to "anon";

grant update on table "public"."member_hiatus_history" to "anon";

grant delete on table "public"."member_hiatus_history" to "authenticated";

grant insert on table "public"."member_hiatus_history" to "authenticated";

grant references on table "public"."member_hiatus_history" to "authenticated";

grant select on table "public"."member_hiatus_history" to "authenticated";

grant trigger on table "public"."member_hiatus_history" to "authenticated";

grant truncate on table "public"."member_hiatus_history" to "authenticated";

grant update on table "public"."member_hiatus_history" to "authenticated";

grant delete on table "public"."member_hiatus_history" to "service_role";

grant insert on table "public"."member_hiatus_history" to "service_role";

grant references on table "public"."member_hiatus_history" to "service_role";

grant select on table "public"."member_hiatus_history" to "service_role";

grant trigger on table "public"."member_hiatus_history" to "service_role";

grant truncate on table "public"."member_hiatus_history" to "service_role";

grant update on table "public"."member_hiatus_history" to "service_role";


