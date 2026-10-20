/**
 * Who the usage numbers count, as two filters shared by every analytics function and both admin
 * pages (/admin/analytics and /admin/analytics/explore):
 *
 * - **Ignore staff** (off by default): leave out events from staff, meaning admins and members with
 *   a staff role. Turn it on once real members use the Hub, so staff testing doesn't read as use.
 * - **Ignore sudo** (on by default): leave out events recorded while an admin was viewing as a
 *   member. Those belong to the member being viewed, so "ignore staff" doesn't remove them; this
 *   filter alone decides whether they count.
 *
 * In the address they are `staff=hide` and `sudo=show` (the non-default values), so a view without
 * either behaves as before and a shared link carries only what was changed.
 */

export interface Audience {
  ignoreStaff: boolean;
  ignoreSudo: boolean;
}

export const DEFAULT_AUDIENCE: Audience = { ignoreStaff: false, ignoreSudo: true };

type Param = string | string[] | undefined;

const first = (value: Param): string | undefined => (Array.isArray(value) ? value[0] : value);

export function parseAudience(params: { staff?: Param; sudo?: Param }): Audience {
  return {
    ignoreStaff: first(params.staff) === "hide",
    ignoreSudo: first(params.sudo) !== "show",
  };
}

/** The query parameters that express `audience`; empty when it is the default. */
export function audienceQuery(audience: Audience): Record<string, string> {
  return {
    ...(audience.ignoreStaff ? { staff: "hide" } : {}),
    ...(audience.ignoreSudo ? {} : { sudo: "show" }),
  };
}

/** The arguments the analytics SQL functions take for `audience`. */
export function audienceRpcArgs(audience: Audience): { ignore_staff: boolean; ignore_sudo: boolean } {
  return { ignore_staff: audience.ignoreStaff, ignore_sudo: audience.ignoreSudo };
}
