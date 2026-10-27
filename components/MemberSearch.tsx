"use client";

import EntitySearch from "@/components/EntitySearch";
import { memberSearchItem } from "@/lib/member-search-item";

interface Member {
  id: string;
  name: string;
  /** The name the community knows them by; the list shows it first and still finds the legal name. */
  displayName?: string | null;
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
      items={members.map(memberSearchItem)}
      selectedId={selectedMemberId}
      selectedName={selectedMemberName}
      onSelect={(item) => onSelect(item ? (members.find((m) => m.id === item.id) ?? null) : null)}
      placeholder={placeholder}
      className={className}
    />
  );
}
