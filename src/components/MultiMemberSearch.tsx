"use client";

import MultiEntitySearch from "@/components/MultiEntitySearch";
import { memberSearchItem } from "@/lib/member-search-item";

interface Member {
  id: string;
  name: string;
  displayName?: string | null;
  /** Shown beside members who are not "active". */
  status?: string;
  /** Optional: admin-only surfaces pass it; member-facing ones never receive other members' emails. */
  email?: string;
}

interface MultiMemberSearchProps {
  members: Member[];
  selectedMemberIds: string[];
  onChange: (memberIds: string[]) => void;
  placeholder?: string;
  className?: string;
}

/** Multi-select variant of MemberSearch: MultiEntitySearch fed with members; selected ones show as removable chips. */
export default function MultiMemberSearch({
  members,
  selectedMemberIds,
  onChange,
  placeholder = "Search for a member...",
  className = "",
}: MultiMemberSearchProps) {
  return (
    <MultiEntitySearch
      items={members.map(memberSearchItem)}
      selectedIds={selectedMemberIds}
      onChange={onChange}
      placeholder={placeholder}
      className={className}
    />
  );
}
