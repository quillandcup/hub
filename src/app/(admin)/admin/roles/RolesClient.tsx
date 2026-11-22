"use client";

import { useMemo } from "react";
import Icon, { type IconName } from "@/components/Icon";
import { DataTableSearch } from "@/components/DataTableSearch";
import { useDataTable } from "@/lib/hooks/useDataTable";
import type { Mark, MatrixArea, MatrixRow, PermissionMatrix } from "@/lib/permission-matrix";

// How each mark looks and what a screen reader hears: the icon is never the only signal.
const MARKS: Record<Mark, { icon: IconName; text: string; className: string }> = {
  granted: { icon: "granted", text: "Has it", className: "text-green-700 dark:text-green-400" },
  none: { icon: "notGranted", text: "Does not have it", className: "text-slate-400 dark:text-slate-500" },
  withheld: { icon: "withheld", text: "Withheld on purpose", className: "text-amber-700 dark:text-amber-400" },
};

function MarkCell({ mark }: { mark: Mark }) {
  const { icon, text, className } = MARKS[mark];
  return (
    <td className="px-3 py-2 text-center align-top">
      <span className={`inline-flex items-center justify-center ${className}`}>
        <Icon name={icon} />
        <span className="sr-only">{text}</span>
      </span>
    </td>
  );
}

function PermissionRow({ row, roles }: { row: MatrixRow; roles: PermissionMatrix["roles"] }) {
  return (
    <tr className="border-t border-slate-200 dark:border-slate-800">
      <th
        scope="row"
        className="sticky left-0 z-raised min-w-48 max-w-64 bg-white px-3 py-2 text-left align-top font-normal dark:bg-slate-900"
      >
        <code className="break-all text-sm font-medium">{row.permission}</code>
        {row.reserved && " "}
        {row.reserved && (
          <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200">
            Reserved
          </span>
        )}
        <p className="text-sm text-slate-600 dark:text-slate-300">{row.description}</p>
        {row.reserved && (
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Reserved: no page, action or route checks it yet, so holding it changes nothing today.
          </p>
        )}
        {row.withheldReason && (
          <p className="text-xs text-amber-800 dark:text-amber-300">Withheld from the assistant: {row.withheldReason}</p>
        )}
      </th>
      {roles.map(({ role }) => (
        <MarkCell key={role} mark={row.marks[role]} />
      ))}
    </tr>
  );
}

function AreaRows({ area, roles }: { area: MatrixArea; roles: PermissionMatrix["roles"] }) {
  return (
    <tbody>
      <tr className="bg-slate-100 dark:bg-slate-800">
        <th scope="rowgroup" colSpan={roles.length + 1} className="p-0 text-left">
          <div className="sticky left-0 w-max px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200">
            {area.area}
          </div>
        </th>
      </tr>
      {area.rows.map((row) => (
        <PermissionRow key={row.permission} row={row} roles={roles} />
      ))}
    </tbody>
  );
}

export default function RolesClient({ matrix }: { matrix: PermissionMatrix }) {
  const allRows = useMemo(() => matrix.areas.flatMap((area) => area.rows), [matrix]);
  const table = useDataTable<MatrixRow, "permission">({
    rows: allRows,
    // Name, description and the roles that hold it, so "conversion" lists what that role may do.
    search: (row) => `${row.permission} ${row.description} ${row.holders.join(" ")} ${row.reserved ? "reserved" : ""}`,
    getSortValue: (row) => row.permission,
    paginate: false,
  });

  const shown = useMemo(() => new Set(table.rows.map((row) => row.permission)), [table.rows]);
  const areas = matrix.areas
    .map((area) => ({ ...area, rows: area.rows.filter((row) => shown.has(row.permission)) }))
    .filter((area) => area.rows.length > 0);

  return (
    <div className="container mx-auto max-w-5xl px-6 py-8">
      <h1 className="mb-1 text-2xl font-bold">Roles</h1>
      <p className="mb-6 text-sm text-slate-600 dark:text-slate-300">
        Who may do what in the staff area. This page is read-only and is built from the permission registry in the code
        (<code>src/lib/permissions.ts</code>), so it is always current; roles change through a code change. A person can hold
        several roles and may do whatever any of them allows (the union): the admin implies everything, and what is withheld
        from the assistant stays withheld unless another role they hold grants it. Roles are given on the Users page.
      </p>
      <section aria-label="Who can give which role" className="mb-6 text-sm text-slate-600 dark:text-slate-300">
        <h2 className="mb-1 text-base font-semibold text-slate-900 dark:text-slate-100">Who can give which role</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>An admin can give or take away any role. They can&apos;t remove their own admin role (another admin does that), and the last admin can&apos;t be removed.</li>
          <li>An assistant can give or take away only Community Manager and Conversion Specialist, and only for people who hold neither Admin nor Assistant.</li>
          <li>Nobody else can change roles. The database enforces this too, not only this page.</li>
        </ul>
      </section>

      <div className="@container mb-6">
        <ul className="grid gap-3 @cards:grid-cols-2 @columns:grid-cols-4" aria-label="Roles">
          {matrix.roles.map((role) => (
            <li key={role.role} className="rounded border border-slate-200 p-3 dark:border-slate-700">
              <h2 className="font-semibold">{role.label}</h2>
              <p className="text-sm text-slate-600 dark:text-slate-300">{role.description}</p>
              <p className="mt-1 text-sm font-medium">
                {role.count} of {matrix.total} permissions
              </p>
            </li>
          ))}
        </ul>
      </div>

      <div className="mb-3 flex flex-col gap-3">
        <DataTableSearch table={table} label="Search permissions or roles" />
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label="Key">
          {(Object.keys(MARKS) as Mark[]).map((mark) => (
            <li key={mark} className={`inline-flex items-center gap-1 ${MARKS[mark].className}`}>
              <Icon name={MARKS[mark].icon} />
              <span className="text-slate-700 dark:text-slate-200">{MARKS[mark].text}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="overflow-x-auto rounded border border-slate-200 dark:border-slate-700">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">Which roles hold each permission</caption>
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-800/50">
              <th
                scope="col"
                className="sticky left-0 z-raised bg-slate-50 px-3 py-2 text-left font-semibold dark:bg-slate-800"
              >
                Permission
              </th>
              {matrix.roles.map((role) => (
                <th key={role.role} scope="col" className="px-3 py-2 text-center font-semibold">
                  {role.label}
                </th>
              ))}
            </tr>
          </thead>
          {areas.map((area) => (
            <AreaRows key={area.area} area={area} roles={matrix.roles} />
          ))}
        </table>
      </div>
      {areas.length === 0 && (
        <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">No permission or role matches that search.</p>
      )}
    </div>
  );
}
