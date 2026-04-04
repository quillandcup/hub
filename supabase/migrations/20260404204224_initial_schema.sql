
  create table "public"."activity_types" (
    "code" text not null,
    "name" text not null,
    "category" text not null,
    "default_engagement_value" integer default 1,
    "description" text,
    "metadata_schema" jsonb,
    "created_at" timestamp with time zone default now()
      );



  create table "public"."attendance" (
    "id" uuid not null default gen_random_uuid(),
    "member_id" uuid not null,
    "session_id" uuid not null,
    "join_time" timestamp with time zone not null,
    "leave_time" timestamp with time zone not null,
    "confidence_score" text not null,
    "created_at" timestamp with time zone default now()
      );



  create table "public"."member_activities" (
    "id" uuid not null default gen_random_uuid(),
    "member_id" uuid not null,
    "activity_type" text not null,
    "activity_category" text not null,
    "title" text not null,
    "description" text,
    "metadata" jsonb,
    "session_id" uuid,
    "related_id" text,
    "engagement_value" integer default 1,
    "duration_minutes" integer,
    "occurred_at" timestamp with time zone not null,
    "created_at" timestamp with time zone default now(),
    "source" text not null
      );



  create table "public"."member_engagement" (
    "member_id" uuid not null,
    "risk_level" text not null,
    "engagement_tier" text not null,
    "churn_probability" double precision,
    "updated_at" timestamp with time zone default now()
      );



  create table "public"."member_metrics" (
    "member_id" uuid not null,
    "last_attended_at" timestamp with time zone,
    "sessions_last_7_days" integer default 0,
    "sessions_last_30_days" integer default 0,
    "total_sessions" integer default 0,
    "engagement_score" integer default 0,
    "updated_at" timestamp with time zone default now()
      );



  create table "public"."members" (
    "id" uuid not null default gen_random_uuid(),
    "name" text not null,
    "email" text not null,
    "joined_at" timestamp with time zone not null,
    "status" text not null,
    "plan" text,
    "raw_payload" jsonb,
    "created_at" timestamp with time zone default now(),
    "updated_at" timestamp with time zone default now()
      );



  create table "public"."session_popularity" (
    "session_id" uuid not null,
    "avg_attendance" double precision,
    "last_5_attendance" integer[],
    "trend" text,
    "updated_at" timestamp with time zone default now()
      );



  create table "public"."sessions" (
    "id" uuid not null default gen_random_uuid(),
    "title" text not null,
    "host" text not null,
    "start_time" timestamp with time zone not null,
    "end_time" timestamp with time zone not null,
    "type" text,
    "source" text not null,
    "created_at" timestamp with time zone default now()
      );



  create table "public"."zoom_attendees" (
    "id" uuid not null default gen_random_uuid(),
    "meeting_id" text not null,
    "meeting_uuid" text,
    "topic" text,
    "participant_id" text,
    "user_id" text,
    "registrant_id" text,
    "name" text not null,
    "email" text,
    "join_time" timestamp with time zone not null,
    "leave_time" timestamp with time zone not null,
    "duration" integer not null,
    "attentiveness_score" integer,
    "failover" boolean,
    "status" text,
    "raw_payload" jsonb,
    "created_at" timestamp with time zone default now()
      );


CREATE UNIQUE INDEX activity_types_pkey ON public.activity_types USING btree (code);

CREATE UNIQUE INDEX attendance_member_id_session_id_key ON public.attendance USING btree (member_id, session_id);

CREATE UNIQUE INDEX attendance_pkey ON public.attendance USING btree (id);

CREATE INDEX idx_attendance_join_time ON public.attendance USING btree (join_time);

CREATE INDEX idx_attendance_member_id ON public.attendance USING btree (member_id);

CREATE INDEX idx_attendance_session_id ON public.attendance USING btree (session_id);

CREATE INDEX idx_member_activities_category ON public.member_activities USING btree (activity_category);

CREATE INDEX idx_member_activities_member_id ON public.member_activities USING btree (member_id);

CREATE INDEX idx_member_activities_occurred_at ON public.member_activities USING btree (occurred_at);

CREATE INDEX idx_member_activities_session_id ON public.member_activities USING btree (session_id);

CREATE INDEX idx_member_activities_type ON public.member_activities USING btree (activity_type);

CREATE INDEX idx_members_email ON public.members USING btree (email);

CREATE INDEX idx_members_status ON public.members USING btree (status);

CREATE INDEX idx_sessions_start_time ON public.sessions USING btree (start_time);

CREATE INDEX idx_sessions_type ON public.sessions USING btree (type);

CREATE INDEX idx_zoom_attendees_email ON public.zoom_attendees USING btree (email);

CREATE INDEX idx_zoom_attendees_join_time ON public.zoom_attendees USING btree (join_time);

CREATE INDEX idx_zoom_attendees_meeting_id ON public.zoom_attendees USING btree (meeting_id);

CREATE INDEX idx_zoom_attendees_user_id ON public.zoom_attendees USING btree (user_id);

CREATE UNIQUE INDEX member_activities_pkey ON public.member_activities USING btree (id);

CREATE UNIQUE INDEX member_engagement_pkey ON public.member_engagement USING btree (member_id);

CREATE UNIQUE INDEX member_metrics_pkey ON public.member_metrics USING btree (member_id);

CREATE UNIQUE INDEX members_email_key ON public.members USING btree (email);

CREATE UNIQUE INDEX members_pkey ON public.members USING btree (id);

CREATE UNIQUE INDEX session_popularity_pkey ON public.session_popularity USING btree (session_id);

CREATE UNIQUE INDEX sessions_pkey ON public.sessions USING btree (id);

CREATE UNIQUE INDEX zoom_attendees_pkey ON public.zoom_attendees USING btree (id);

alter table "public"."activity_types" add constraint "activity_types_pkey" PRIMARY KEY using index "activity_types_pkey";

alter table "public"."attendance" add constraint "attendance_pkey" PRIMARY KEY using index "attendance_pkey";

alter table "public"."member_activities" add constraint "member_activities_pkey" PRIMARY KEY using index "member_activities_pkey";

alter table "public"."member_engagement" add constraint "member_engagement_pkey" PRIMARY KEY using index "member_engagement_pkey";

alter table "public"."member_metrics" add constraint "member_metrics_pkey" PRIMARY KEY using index "member_metrics_pkey";

alter table "public"."members" add constraint "members_pkey" PRIMARY KEY using index "members_pkey";

alter table "public"."session_popularity" add constraint "session_popularity_pkey" PRIMARY KEY using index "session_popularity_pkey";

alter table "public"."sessions" add constraint "sessions_pkey" PRIMARY KEY using index "sessions_pkey";

alter table "public"."zoom_attendees" add constraint "zoom_attendees_pkey" PRIMARY KEY using index "zoom_attendees_pkey";

alter table "public"."attendance" add constraint "attendance_confidence_score_check" CHECK ((confidence_score = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text]))) not valid;

alter table "public"."attendance" validate constraint "attendance_confidence_score_check";

alter table "public"."attendance" add constraint "attendance_member_id_fkey" FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE not valid;

alter table "public"."attendance" validate constraint "attendance_member_id_fkey";

alter table "public"."attendance" add constraint "attendance_member_id_session_id_key" UNIQUE using index "attendance_member_id_session_id_key";

alter table "public"."attendance" add constraint "attendance_session_id_fkey" FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE not valid;

alter table "public"."attendance" validate constraint "attendance_session_id_fkey";

alter table "public"."member_activities" add constraint "member_activities_member_id_fkey" FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE not valid;

alter table "public"."member_activities" validate constraint "member_activities_member_id_fkey";

alter table "public"."member_activities" add constraint "member_activities_session_id_fkey" FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE SET NULL not valid;

alter table "public"."member_activities" validate constraint "member_activities_session_id_fkey";

alter table "public"."member_engagement" add constraint "member_engagement_engagement_tier_check" CHECK ((engagement_tier = ANY (ARRAY['highly_engaged'::text, 'active'::text, 'at_risk'::text]))) not valid;

alter table "public"."member_engagement" validate constraint "member_engagement_engagement_tier_check";

alter table "public"."member_engagement" add constraint "member_engagement_member_id_fkey" FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE not valid;

alter table "public"."member_engagement" validate constraint "member_engagement_member_id_fkey";

alter table "public"."member_engagement" add constraint "member_engagement_risk_level_check" CHECK ((risk_level = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text]))) not valid;

alter table "public"."member_engagement" validate constraint "member_engagement_risk_level_check";

alter table "public"."member_metrics" add constraint "member_metrics_member_id_fkey" FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE not valid;

alter table "public"."member_metrics" validate constraint "member_metrics_member_id_fkey";

alter table "public"."members" add constraint "members_email_key" UNIQUE using index "members_email_key";

alter table "public"."members" add constraint "members_status_check" CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text]))) not valid;

alter table "public"."members" validate constraint "members_status_check";

alter table "public"."session_popularity" add constraint "session_popularity_session_id_fkey" FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE not valid;

alter table "public"."session_popularity" validate constraint "session_popularity_session_id_fkey";

alter table "public"."session_popularity" add constraint "session_popularity_trend_check" CHECK ((trend = ANY (ARRAY['increasing'::text, 'stable'::text, 'decreasing'::text]))) not valid;

alter table "public"."session_popularity" validate constraint "session_popularity_trend_check";

alter table "public"."sessions" add constraint "sessions_source_check" CHECK ((source = ANY (ARRAY['calendar'::text, 'slack'::text, 'sheets'::text]))) not valid;

alter table "public"."sessions" validate constraint "sessions_source_check";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$function$
;

grant delete on table "public"."activity_types" to "anon";

grant insert on table "public"."activity_types" to "anon";

grant references on table "public"."activity_types" to "anon";

grant select on table "public"."activity_types" to "anon";

grant trigger on table "public"."activity_types" to "anon";

grant truncate on table "public"."activity_types" to "anon";

grant update on table "public"."activity_types" to "anon";

grant delete on table "public"."activity_types" to "authenticated";

grant insert on table "public"."activity_types" to "authenticated";

grant references on table "public"."activity_types" to "authenticated";

grant select on table "public"."activity_types" to "authenticated";

grant trigger on table "public"."activity_types" to "authenticated";

grant truncate on table "public"."activity_types" to "authenticated";

grant update on table "public"."activity_types" to "authenticated";

grant delete on table "public"."activity_types" to "service_role";

grant insert on table "public"."activity_types" to "service_role";

grant references on table "public"."activity_types" to "service_role";

grant select on table "public"."activity_types" to "service_role";

grant trigger on table "public"."activity_types" to "service_role";

grant truncate on table "public"."activity_types" to "service_role";

grant update on table "public"."activity_types" to "service_role";

grant delete on table "public"."attendance" to "anon";

grant insert on table "public"."attendance" to "anon";

grant references on table "public"."attendance" to "anon";

grant select on table "public"."attendance" to "anon";

grant trigger on table "public"."attendance" to "anon";

grant truncate on table "public"."attendance" to "anon";

grant update on table "public"."attendance" to "anon";

grant delete on table "public"."attendance" to "authenticated";

grant insert on table "public"."attendance" to "authenticated";

grant references on table "public"."attendance" to "authenticated";

grant select on table "public"."attendance" to "authenticated";

grant trigger on table "public"."attendance" to "authenticated";

grant truncate on table "public"."attendance" to "authenticated";

grant update on table "public"."attendance" to "authenticated";

grant delete on table "public"."attendance" to "service_role";

grant insert on table "public"."attendance" to "service_role";

grant references on table "public"."attendance" to "service_role";

grant select on table "public"."attendance" to "service_role";

grant trigger on table "public"."attendance" to "service_role";

grant truncate on table "public"."attendance" to "service_role";

grant update on table "public"."attendance" to "service_role";

grant delete on table "public"."member_activities" to "anon";

grant insert on table "public"."member_activities" to "anon";

grant references on table "public"."member_activities" to "anon";

grant select on table "public"."member_activities" to "anon";

grant trigger on table "public"."member_activities" to "anon";

grant truncate on table "public"."member_activities" to "anon";

grant update on table "public"."member_activities" to "anon";

grant delete on table "public"."member_activities" to "authenticated";

grant insert on table "public"."member_activities" to "authenticated";

grant references on table "public"."member_activities" to "authenticated";

grant select on table "public"."member_activities" to "authenticated";

grant trigger on table "public"."member_activities" to "authenticated";

grant truncate on table "public"."member_activities" to "authenticated";

grant update on table "public"."member_activities" to "authenticated";

grant delete on table "public"."member_activities" to "service_role";

grant insert on table "public"."member_activities" to "service_role";

grant references on table "public"."member_activities" to "service_role";

grant select on table "public"."member_activities" to "service_role";

grant trigger on table "public"."member_activities" to "service_role";

grant truncate on table "public"."member_activities" to "service_role";

grant update on table "public"."member_activities" to "service_role";

grant delete on table "public"."member_engagement" to "anon";

grant insert on table "public"."member_engagement" to "anon";

grant references on table "public"."member_engagement" to "anon";

grant select on table "public"."member_engagement" to "anon";

grant trigger on table "public"."member_engagement" to "anon";

grant truncate on table "public"."member_engagement" to "anon";

grant update on table "public"."member_engagement" to "anon";

grant delete on table "public"."member_engagement" to "authenticated";

grant insert on table "public"."member_engagement" to "authenticated";

grant references on table "public"."member_engagement" to "authenticated";

grant select on table "public"."member_engagement" to "authenticated";

grant trigger on table "public"."member_engagement" to "authenticated";

grant truncate on table "public"."member_engagement" to "authenticated";

grant update on table "public"."member_engagement" to "authenticated";

grant delete on table "public"."member_engagement" to "service_role";

grant insert on table "public"."member_engagement" to "service_role";

grant references on table "public"."member_engagement" to "service_role";

grant select on table "public"."member_engagement" to "service_role";

grant trigger on table "public"."member_engagement" to "service_role";

grant truncate on table "public"."member_engagement" to "service_role";

grant update on table "public"."member_engagement" to "service_role";

grant delete on table "public"."member_metrics" to "anon";

grant insert on table "public"."member_metrics" to "anon";

grant references on table "public"."member_metrics" to "anon";

grant select on table "public"."member_metrics" to "anon";

grant trigger on table "public"."member_metrics" to "anon";

grant truncate on table "public"."member_metrics" to "anon";

grant update on table "public"."member_metrics" to "anon";

grant delete on table "public"."member_metrics" to "authenticated";

grant insert on table "public"."member_metrics" to "authenticated";

grant references on table "public"."member_metrics" to "authenticated";

grant select on table "public"."member_metrics" to "authenticated";

grant trigger on table "public"."member_metrics" to "authenticated";

grant truncate on table "public"."member_metrics" to "authenticated";

grant update on table "public"."member_metrics" to "authenticated";

grant delete on table "public"."member_metrics" to "service_role";

grant insert on table "public"."member_metrics" to "service_role";

grant references on table "public"."member_metrics" to "service_role";

grant select on table "public"."member_metrics" to "service_role";

grant trigger on table "public"."member_metrics" to "service_role";

grant truncate on table "public"."member_metrics" to "service_role";

grant update on table "public"."member_metrics" to "service_role";

grant delete on table "public"."members" to "anon";

grant insert on table "public"."members" to "anon";

grant references on table "public"."members" to "anon";

grant select on table "public"."members" to "anon";

grant trigger on table "public"."members" to "anon";

grant truncate on table "public"."members" to "anon";

grant update on table "public"."members" to "anon";

grant delete on table "public"."members" to "authenticated";

grant insert on table "public"."members" to "authenticated";

grant references on table "public"."members" to "authenticated";

grant select on table "public"."members" to "authenticated";

grant trigger on table "public"."members" to "authenticated";

grant truncate on table "public"."members" to "authenticated";

grant update on table "public"."members" to "authenticated";

grant delete on table "public"."members" to "service_role";

grant insert on table "public"."members" to "service_role";

grant references on table "public"."members" to "service_role";

grant select on table "public"."members" to "service_role";

grant trigger on table "public"."members" to "service_role";

grant truncate on table "public"."members" to "service_role";

grant update on table "public"."members" to "service_role";

grant delete on table "public"."session_popularity" to "anon";

grant insert on table "public"."session_popularity" to "anon";

grant references on table "public"."session_popularity" to "anon";

grant select on table "public"."session_popularity" to "anon";

grant trigger on table "public"."session_popularity" to "anon";

grant truncate on table "public"."session_popularity" to "anon";

grant update on table "public"."session_popularity" to "anon";

grant delete on table "public"."session_popularity" to "authenticated";

grant insert on table "public"."session_popularity" to "authenticated";

grant references on table "public"."session_popularity" to "authenticated";

grant select on table "public"."session_popularity" to "authenticated";

grant trigger on table "public"."session_popularity" to "authenticated";

grant truncate on table "public"."session_popularity" to "authenticated";

grant update on table "public"."session_popularity" to "authenticated";

grant delete on table "public"."session_popularity" to "service_role";

grant insert on table "public"."session_popularity" to "service_role";

grant references on table "public"."session_popularity" to "service_role";

grant select on table "public"."session_popularity" to "service_role";

grant trigger on table "public"."session_popularity" to "service_role";

grant truncate on table "public"."session_popularity" to "service_role";

grant update on table "public"."session_popularity" to "service_role";

grant delete on table "public"."sessions" to "anon";

grant insert on table "public"."sessions" to "anon";

grant references on table "public"."sessions" to "anon";

grant select on table "public"."sessions" to "anon";

grant trigger on table "public"."sessions" to "anon";

grant truncate on table "public"."sessions" to "anon";

grant update on table "public"."sessions" to "anon";

grant delete on table "public"."sessions" to "authenticated";

grant insert on table "public"."sessions" to "authenticated";

grant references on table "public"."sessions" to "authenticated";

grant select on table "public"."sessions" to "authenticated";

grant trigger on table "public"."sessions" to "authenticated";

grant truncate on table "public"."sessions" to "authenticated";

grant update on table "public"."sessions" to "authenticated";

grant delete on table "public"."sessions" to "service_role";

grant insert on table "public"."sessions" to "service_role";

grant references on table "public"."sessions" to "service_role";

grant select on table "public"."sessions" to "service_role";

grant trigger on table "public"."sessions" to "service_role";

grant truncate on table "public"."sessions" to "service_role";

grant update on table "public"."sessions" to "service_role";

grant delete on table "public"."zoom_attendees" to "anon";

grant insert on table "public"."zoom_attendees" to "anon";

grant references on table "public"."zoom_attendees" to "anon";

grant select on table "public"."zoom_attendees" to "anon";

grant trigger on table "public"."zoom_attendees" to "anon";

grant truncate on table "public"."zoom_attendees" to "anon";

grant update on table "public"."zoom_attendees" to "anon";

grant delete on table "public"."zoom_attendees" to "authenticated";

grant insert on table "public"."zoom_attendees" to "authenticated";

grant references on table "public"."zoom_attendees" to "authenticated";

grant select on table "public"."zoom_attendees" to "authenticated";

grant trigger on table "public"."zoom_attendees" to "authenticated";

grant truncate on table "public"."zoom_attendees" to "authenticated";

grant update on table "public"."zoom_attendees" to "authenticated";

grant delete on table "public"."zoom_attendees" to "service_role";

grant insert on table "public"."zoom_attendees" to "service_role";

grant references on table "public"."zoom_attendees" to "service_role";

grant select on table "public"."zoom_attendees" to "service_role";

grant trigger on table "public"."zoom_attendees" to "service_role";

grant truncate on table "public"."zoom_attendees" to "service_role";

grant update on table "public"."zoom_attendees" to "service_role";

CREATE TRIGGER update_member_engagement_updated_at BEFORE UPDATE ON public.member_engagement FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_member_metrics_updated_at BEFORE UPDATE ON public.member_metrics FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_members_updated_at BEFORE UPDATE ON public.members FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_session_popularity_updated_at BEFORE UPDATE ON public.session_popularity FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


