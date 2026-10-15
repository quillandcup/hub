"use client";

import MultiEntitySearch from "@/components/MultiEntitySearch";

interface Member {
  id: string;
  name: string;
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
      items={members.map((m) => ({ id: m.id, name: m.name, detail: m.email }))}
      selectedIds={selectedMemberIds}
      onChange={onChange}
      placeholder={placeholder}
      className={className}
    />
  );
}
