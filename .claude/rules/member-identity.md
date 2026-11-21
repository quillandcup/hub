---
paths:
  - "src/app/(member)/**"
  - "src/lib/sudo*.ts"
  - "src/lib/auth.ts"
  - "src/app/actions/sudo.ts"
---

### Member Identity Resolution

**RULE**: Member-facing pages (`src/app/(member)/`) must use `getEffectiveIdentity` to resolve the current member, not `supabase.auth.getUser()` alone.

**Why**: Admins can use sudo mode to browse as a specific member. `getEffectiveIdentity` returns the *effective* member identity — the sudo'd member when active, the real user's member record otherwise. Pages that skip this and use the raw auth user ID will show the admin's own data during sudo, breaking the sudo experience.

**Required pattern**:

```typescript
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";

// ✅ CORRECT: Use effective identity for member data
const user = await getCurrentUser(); // verified JWT claims, no Auth round trip
if (!user) redirect("/login");

const effectiveIdentity = await getEffectiveIdentity(user);
if (!effectiveIdentity) redirect("/admin"); // admin with no member record

// Use effectiveIdentity.memberId for all member-scoped queries
const { data } = await supabase
  .from("attendance")
  .select("*")
  .eq("member_id", effectiveIdentity.memberId);

// ❌ WRONG: Using raw auth user ID bypasses sudo
const { data: { user } } = await supabase.auth.getUser();
const { data: member } = await supabase
  .from("members")
  .select("*")
  .eq("email", user.email); // breaks during sudo — returns admin's record
```

**Role-aware links (admin vs member URLs)**:

When a page needs to show different links for admins vs regular members (e.g. `/admin/members/{id}` vs `/members/{id}`), combine the role check with sudo state:

```typescript
const [profileResult, effectiveIdentity] = await Promise.all([
  supabase.from("user_profiles").select("role").eq("id", user.id).single(),
  getEffectiveIdentity(user),
]);
const isAdmin = profileResult.data?.role === "admin";
const isActingAsAdmin = isAdmin && !effectiveIdentity?.isSudo;
const memberBasePath = isActingAsAdmin ? "/admin/members" : "/members";
```

**`EffectiveIdentity` fields**: `memberId`, `memberName`, `memberEmail`, `isSudo: boolean`

**Auth lookups in server code**: Use `getCurrentUser()` from `src/lib/auth.ts` (returns `{ id, email }` or `null`) in layouts, pages, server actions and API routes. It verifies the JWT locally via `supabase.auth.getClaims()` and is memoized per render with React `cache()`, so layout + page share one check. Only `src/lib/supabase/middleware.ts` (token refresh + live-session check) and code that needs fields absent from the JWT (`last_sign_in_at`, `identities`, etc.) or must confirm the session is still live server-side (e.g. session management in `src/app/(member)/settings/actions.ts`) should call `supabase.auth.getUser()`.
