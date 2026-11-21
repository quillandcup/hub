---
paths:
  - "lib/care*.ts"
  - "lib/data/care*.ts"
  - "app/**/care/**"
  - "supabase/migrations/*care*"
---

### Hand-overs Need Both Sides

**RULE**: A thing that belongs to one person (a care plan, later a mentorship or an inbox thread) changes hands only when the receiver accepts: propose, accept, decline, cancel, and the database refuses a direct change of owner. Hedgie Care is the first user (`docs/product/HEDGIE_CARE.md`, "Owners"; `supabase/migrations/20270726000000_care_handover.sql`). **One exception, by the owner's decision (2026-11-15): an admin may take an open care plan over from its owner in one step, because the owner can be unreachable or an admin has to step in; the previous owner is told on their Hedgie Care page, and nobody else gets this** (`claim_care_plan`, `20270801090000_care_admin_takeover.sql`). The database still refuses every other change of owner, admin and service role included.
