drop trigger if exists "update_session_popularity_updated_at" on "public"."session_popularity";

revoke delete on table "public"."session_popularity" from "anon";

revoke insert on table "public"."session_popularity" from "anon";

revoke references on table "public"."session_popularity" from "anon";

revoke select on table "public"."session_popularity" from "anon";

revoke trigger on table "public"."session_popularity" from "anon";

revoke truncate on table "public"."session_popularity" from "anon";

revoke update on table "public"."session_popularity" from "anon";

revoke delete on table "public"."session_popularity" from "authenticated";

revoke insert on table "public"."session_popularity" from "authenticated";

revoke references on table "public"."session_popularity" from "authenticated";

revoke select on table "public"."session_popularity" from "authenticated";

revoke trigger on table "public"."session_popularity" from "authenticated";

revoke truncate on table "public"."session_popularity" from "authenticated";

revoke update on table "public"."session_popularity" from "authenticated";

revoke delete on table "public"."session_popularity" from "service_role";

revoke insert on table "public"."session_popularity" from "service_role";

revoke references on table "public"."session_popularity" from "service_role";

revoke select on table "public"."session_popularity" from "service_role";

revoke trigger on table "public"."session_popularity" from "service_role";

revoke truncate on table "public"."session_popularity" from "service_role";

revoke update on table "public"."session_popularity" from "service_role";

revoke delete on table "public"."sessions" from "anon";

revoke insert on table "public"."sessions" from "anon";

revoke references on table "public"."sessions" from "anon";

revoke select on table "public"."sessions" from "anon";

revoke trigger on table "public"."sessions" from "anon";

revoke truncate on table "public"."sessions" from "anon";

revoke update on table "public"."sessions" from "anon";

revoke delete on table "public"."sessions" from "authenticated";

revoke insert on table "public"."sessions" from "authenticated";

revoke references on table "public"."sessions" from "authenticated";

revoke select on table "public"."sessions" from "authenticated";

revoke trigger on table "public"."sessions" from "authenticated";

revoke truncate on table "public"."sessions" from "authenticated";

revoke update on table "public"."sessions" from "authenticated";

revoke delete on table "public"."sessions" from "service_role";

revoke insert on table "public"."sessions" from "service_role";

revoke references on table "public"."sessions" from "service_role";

revoke select on table "public"."sessions" from "service_role";

revoke trigger on table "public"."sessions" from "service_role";

revoke truncate on table "public"."sessions" from "service_role";

revoke update on table "public"."sessions" from "service_role";

alter table "public"."attendance" drop constraint "attendance_member_id_session_id_key";

alter table "public"."attendance" drop constraint "attendance_session_id_fkey";

alter table "public"."member_activities" drop constraint "member_activities_session_id_fkey";

alter table "public"."session_popularity" drop constraint "session_popularity_session_id_fkey";

alter table "public"."session_popularity" drop constraint "session_popularity_trend_check";

alter table "public"."sessions" drop constraint "sessions_source_check";

alter table "public"."session_popularity" drop constraint "session_popularity_pkey";

alter table "public"."sessions" drop constraint "sessions_pkey";

drop index if exists "public"."attendance_member_id_session_id_key";

drop index if exists "public"."idx_attendance_session_id";

drop index if exists "public"."idx_member_activities_session_id";

drop index if exists "public"."idx_sessions_start_time";

drop index if exists "public"."idx_sessions_type";

drop index if exists "public"."session_popularity_pkey";

drop index if exists "public"."sessions_pkey";

drop table "public"."session_popularity";

drop table "public"."sessions";


  create table "public"."prickle_popularity" (
    "prickle_id" uuid not null,
    "avg_attendance" double precision,
    "last_5_attendance" integer[],
    "trend" text,
    "updated_at" timestamp with time zone default now()
      );



  create table "public"."prickles" (
    "id" uuid not null default gen_random_uuid(),
    "title" text not null,
    "host" text not null,
    "start_time" timestamp with time zone not null,
    "end_time" timestamp with time zone not null,
    "type" text,
    "source" text not null,
    "created_at" timestamp with time zone default now()
      );


alter table "public"."attendance" drop column "session_id";

alter table "public"."attendance" add column "prickle_id" uuid not null;

alter table "public"."member_activities" drop column "session_id";

alter table "public"."member_activities" add column "prickle_id" uuid;

alter table "public"."member_metrics" drop column "sessions_last_30_days";

alter table "public"."member_metrics" drop column "sessions_last_7_days";

alter table "public"."member_metrics" drop column "total_sessions";

alter table "public"."member_metrics" add column "prickles_last_30_days" integer default 0;

alter table "public"."member_metrics" add column "prickles_last_7_days" integer default 0;

alter table "public"."member_metrics" add column "total_prickles" integer default 0;

CREATE UNIQUE INDEX attendance_member_id_prickle_id_key ON public.attendance USING btree (member_id, prickle_id);

CREATE INDEX idx_attendance_prickle_id ON public.attendance USING btree (prickle_id);

CREATE INDEX idx_member_activities_prickle_id ON public.member_activities USING btree (prickle_id);

CREATE INDEX idx_prickles_start_time ON public.prickles USING btree (start_time);

CREATE INDEX idx_prickles_type ON public.prickles USING btree (type);

CREATE UNIQUE INDEX prickle_popularity_pkey ON public.prickle_popularity USING btree (prickle_id);

CREATE UNIQUE INDEX prickles_pkey ON public.prickles USING btree (id);

alter table "public"."prickle_popularity" add constraint "prickle_popularity_pkey" PRIMARY KEY using index "prickle_popularity_pkey";

alter table "public"."prickles" add constraint "prickles_pkey" PRIMARY KEY using index "prickles_pkey";

alter table "public"."attendance" add constraint "attendance_member_id_prickle_id_key" UNIQUE using index "attendance_member_id_prickle_id_key";

alter table "public"."attendance" add constraint "attendance_prickle_id_fkey" FOREIGN KEY (prickle_id) REFERENCES public.prickles(id) ON DELETE CASCADE not valid;

alter table "public"."attendance" validate constraint "attendance_prickle_id_fkey";

alter table "public"."member_activities" add constraint "member_activities_prickle_id_fkey" FOREIGN KEY (prickle_id) REFERENCES public.prickles(id) ON DELETE SET NULL not valid;

alter table "public"."member_activities" validate constraint "member_activities_prickle_id_fkey";

alter table "public"."prickle_popularity" add constraint "prickle_popularity_prickle_id_fkey" FOREIGN KEY (prickle_id) REFERENCES public.prickles(id) ON DELETE CASCADE not valid;

alter table "public"."prickle_popularity" validate constraint "prickle_popularity_prickle_id_fkey";

alter table "public"."prickle_popularity" add constraint "prickle_popularity_trend_check" CHECK ((trend = ANY (ARRAY['increasing'::text, 'stable'::text, 'decreasing'::text]))) not valid;

alter table "public"."prickle_popularity" validate constraint "prickle_popularity_trend_check";

alter table "public"."prickles" add constraint "prickles_source_check" CHECK ((source = ANY (ARRAY['calendar'::text, 'slack'::text, 'sheets'::text]))) not valid;

alter table "public"."prickles" validate constraint "prickles_source_check";

grant delete on table "public"."prickle_popularity" to "anon";

grant insert on table "public"."prickle_popularity" to "anon";

grant references on table "public"."prickle_popularity" to "anon";

grant select on table "public"."prickle_popularity" to "anon";

grant trigger on table "public"."prickle_popularity" to "anon";

grant truncate on table "public"."prickle_popularity" to "anon";

grant update on table "public"."prickle_popularity" to "anon";

grant delete on table "public"."prickle_popularity" to "authenticated";

grant insert on table "public"."prickle_popularity" to "authenticated";

grant references on table "public"."prickle_popularity" to "authenticated";

grant select on table "public"."prickle_popularity" to "authenticated";

grant trigger on table "public"."prickle_popularity" to "authenticated";

grant truncate on table "public"."prickle_popularity" to "authenticated";

grant update on table "public"."prickle_popularity" to "authenticated";

grant delete on table "public"."prickle_popularity" to "service_role";

grant insert on table "public"."prickle_popularity" to "service_role";

grant references on table "public"."prickle_popularity" to "service_role";

grant select on table "public"."prickle_popularity" to "service_role";

grant trigger on table "public"."prickle_popularity" to "service_role";

grant truncate on table "public"."prickle_popularity" to "service_role";

grant update on table "public"."prickle_popularity" to "service_role";

grant delete on table "public"."prickles" to "anon";

grant insert on table "public"."prickles" to "anon";

grant references on table "public"."prickles" to "anon";

grant select on table "public"."prickles" to "anon";

grant trigger on table "public"."prickles" to "anon";

grant truncate on table "public"."prickles" to "anon";

grant update on table "public"."prickles" to "anon";

grant delete on table "public"."prickles" to "authenticated";

grant insert on table "public"."prickles" to "authenticated";

grant references on table "public"."prickles" to "authenticated";

grant select on table "public"."prickles" to "authenticated";

grant trigger on table "public"."prickles" to "authenticated";

grant truncate on table "public"."prickles" to "authenticated";

grant update on table "public"."prickles" to "authenticated";

grant delete on table "public"."prickles" to "service_role";

grant insert on table "public"."prickles" to "service_role";

grant references on table "public"."prickles" to "service_role";

grant select on table "public"."prickles" to "service_role";

grant trigger on table "public"."prickles" to "service_role";

grant truncate on table "public"."prickles" to "service_role";

grant update on table "public"."prickles" to "service_role";

CREATE TRIGGER update_prickle_popularity_updated_at BEFORE UPDATE ON public.prickle_popularity FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


