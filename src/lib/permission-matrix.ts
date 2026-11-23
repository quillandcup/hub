import {
  ALL_PERMISSIONS,
  ASSISTANT_WITHHELD,
  ASSISTANT_WITHHELD_REASONS,
  PERMISSIONS,
  RESERVED_PERMISSIONS,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  STAFF_ROLES,
  type StaffRole,
} from "@/lib/permissions";

/** Whether a role holds a permission: yes, no, or kept from the assistant on purpose (`ASSISTANT_WITHHELD`). */
export type Mark = "granted" | "none" | "withheld";

export interface MatrixRole {
  role: StaffRole;
  label: string;
  description: string;
  /** How many permissions the role holds. */
  count: number;
}

export interface MatrixRow {
  permission: string;
  description: string;
  /** No page, action or route checks it yet (`RESERVED_PERMISSIONS`). */
  reserved: boolean;
  marks: Record<StaffRole, Mark>;
  /** Why the assistant does not hold it, when it is withheld. */
  withheldReason?: string;
  /** The label of every role that holds it, for searching. */
  holders: string[];
}

export interface MatrixArea {
  /** The part of the permission name before the first dot. */
  area: string;
  rows: MatrixRow[];
}

export interface PermissionMatrix {
  roles: MatrixRole[];
  total: number;
  areas: MatrixArea[];
}

/**
 * The Roles page's data, read from the registry in `src/lib/permissions.ts` and nothing else, so a permission or a role
 * added there shows up without touching the page.
 */
export function buildPermissionMatrix(): PermissionMatrix {
  const roles: MatrixRole[] = STAFF_ROLES.map((role) => ({
    role,
    label: ROLE_LABELS[role],
    description: ROLE_DESCRIPTIONS[role],
    count: ROLE_PERMISSIONS[role].length,
  }));

  const areas: MatrixArea[] = [];
  for (const permission of ALL_PERMISSIONS) {
    const marks = {} as Record<StaffRole, Mark>;
    for (const role of STAFF_ROLES) {
      marks[role] = ROLE_PERMISSIONS[role].includes(permission) ? "granted" : "none";
    }
    const withheld = ASSISTANT_WITHHELD.includes(permission);
    if (withheld) marks.assistant = "withheld";

    const row: MatrixRow = {
      permission,
      description: PERMISSIONS[permission],
      reserved: RESERVED_PERMISSIONS.includes(permission),
      marks,
      withheldReason: withheld ? ASSISTANT_WITHHELD_REASONS[permission] : undefined,
      holders: STAFF_ROLES.filter((role) => marks[role] === "granted").map((role) => ROLE_LABELS[role]),
    };

    const area = permission.split(".")[0];
    const last = areas[areas.length - 1];
    if (last && last.area === area) last.rows.push(row);
    else areas.push({ area, rows: [row] });
  }
  return { roles, total: ALL_PERMISSIONS.length, areas };
}
