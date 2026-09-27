"use client";

import MembersTable, { type MemberRow } from "./MembersTable";
import { useServerDataTable } from "@/lib/hooks/useDataTable";
import { DEFAULT_MEMBER_SORT, MEMBER_SORT_COLUMNS, type MemberSortColumn } from "@/lib/admin-members-paging";

// All Members in server mode: `members` is the one page the query already
// filtered, sorted and ranged; header clicks and page changes update
// ?sort=&dir=&page=&pageSize=, which the page reads back.
export default function PagedMembersTable({
  members,
  total,
  page,
  pageSize,
}: {
  members: MemberRow[];
  total: number;
  page: number;
  pageSize: number;
}) {
  const table = useServerDataTable<MemberRow, MemberSortColumn>({
    rows: members,
    total,
    page,
    pageSize,
    allowed: MEMBER_SORT_COLUMNS,
    defaultSort: DEFAULT_MEMBER_SORT,
  });

  return (
    <MembersTable
      // Selection is per page: a new page/sort/filter starts with nothing checked.
      key={members.map((m) => m.id).join(",")}
      members={members}
      table={table}
    />
  );
}
