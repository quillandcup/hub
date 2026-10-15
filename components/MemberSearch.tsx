"use client";

import EntitySearch from "@/components/EntitySearch";

interface Member {
  id: string;
  name: string;
  email: string;
}

interface MemberSearchProps {
  members: Member[];
  selectedMemberId: string | null;
  selectedMemberName?: string | null;
  onSelect: (member: Member | null) => void;
  placeholder?: string;
  className?: string;
}

/**
 * Reusable member search/autocomplete component: EntitySearch fed with members
 * (name + email). Shows selected member with clear button, or search input with dropdown.
 */
export default function MemberSearch({
  members,
  selectedMemberId,
  selectedMemberName,
  onSelect,
  placeholder = "Search for member...",
  className = "",
}: MemberSearchProps) {
  return (
    <EntitySearch
      items={members.map((m) => ({ id: m.id, name: m.name, detail: m.email }))}
      selectedId={selectedMemberId}
      selectedName={selectedMemberName}
      onSelect={(item) => onSelect(item ? (members.find((m) => m.id === item.id) ?? null) : null)}
      placeholder={placeholder}
      className={className}
    />
  );
}
