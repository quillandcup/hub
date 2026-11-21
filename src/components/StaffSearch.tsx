"use client";

import EntitySearch from "@/components/EntitySearch";

export interface StaffUser {
  /** The Hedgie Hub user (auth) id, not a member id. */
  id: string;
  name: string;
  email: string;
  role: string;
}

interface StaffSearchProps {
  staff: StaffUser[];
  selectedUserId: string | null;
  selectedName?: string | null;
  onSelect: (user: StaffUser | null) => void;
  placeholder?: string;
  className?: string;
}

/** EntitySearch fed with admins/staff (name + email · role), keyed by user id. */
export default function StaffSearch({
  staff,
  selectedUserId,
  selectedName,
  onSelect,
  placeholder = "Search for staff...",
  className = "",
}: StaffSearchProps) {
  return (
    <EntitySearch
      items={staff.map((s) => ({ id: s.id, name: s.name, detail: `${s.email} · ${s.role}` }))}
      selectedId={selectedUserId}
      selectedName={selectedName}
      onSelect={(item) => onSelect(item ? (staff.find((s) => s.id === item.id) ?? null) : null)}
      placeholder={placeholder}
      className={className}
    />
  );
}
