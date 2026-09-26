"use client";

import MembersTable, { type MemberRow } from "./MembersTable";
import { Pagination } from "@/components/Pagination";
import { useUrlTableState } from "@/lib/hooks/useUrlTableState";
import { DEFAULT_MEMBER_SORT, MEMBER_SORT_COLUMNS, type MemberSortColumn } from "@/lib/admin-members-paging";

// MembersTable driven by the URL: the server already sorted and ranged `members`
// (one page); header clicks and page changes update ?sort=&dir=&page=&pageSize=.
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
  const state = useUrlTableState<MemberSortColumn>({
    allowed: MEMBER_SORT_COLUMNS,
    defaultSort: DEFAULT_MEMBER_SORT,
  });

  return (
    <>
      <MembersTable
        // Selection is per page: a new page/sort/filter starts with nothing checked.
        key={members.map((m) => m.id).join(",")}
        members={members}
        sort={{ sortColumn: state.sortColumn, sortDirection: state.sortDirection, onSort: state.handleSort }}
      />
      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={state.setPage}
        onPageSizeChange={state.setPageSize}
        itemLabel="members"
      />
    </>
  );
}
