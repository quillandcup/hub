drop index if exists "public"."idx_members_hiatus_end";

alter table "public"."members" drop column "hiatus_end_date";

alter table "public"."members" drop column "hiatus_reason";

alter table "public"."members" drop column "hiatus_start_date";


