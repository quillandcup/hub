"use client";

import { useState } from "react";

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
 * Reusable member search/autocomplete component
 * Shows selected member with clear button, or search input with dropdown
 */
export default function MemberSearch({
  members,
  selectedMemberId,
  selectedMemberName,
  onSelect,
  placeholder = "Search for member...",
  className = "",
}: MemberSearchProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [isFocused, setIsFocused] = useState(false);

  const selectedMember = selectedMemberId
    ? members.find((m) => m.id === selectedMemberId)
    : null;

  const displayName = selectedMember?.name || selectedMemberName;

  // Filter members based on search term
  const filteredMembers = searchTerm
    ? members
        .filter(
          (m) =>
            m.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            m.email.toLowerCase().includes(searchTerm.toLowerCase())
        )
        .slice(0, 10)
    : [];

  const showDropdown = isFocused && filteredMembers.length > 0;

  function handleSelect(member: Member | null) {
    onSelect(member);
    setSearchTerm("");
    setIsFocused(false);
  }

  return (
    <div className={`relative ${className}`}>
      {displayName && !isFocused ? (
        <div className="flex items-center justify-between px-3 py-2 bg-white border rounded text-sm">
          <span className="flex-1 truncate">{displayName}</span>
          <button
            type="button"
            onClick={() => handleSelect(null)}
            className="ml-2 text-gray-400 hover:text-gray-600"
            title="Clear selection"
          >
            ✕
          </button>
        </div>
      ) : (
        <>
          <input
            type="text"
            placeholder={placeholder}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setTimeout(() => setIsFocused(false), 200)}
            className="w-full px-3 py-2 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {showDropdown && (
            <div className="absolute z-10 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-60 overflow-y-auto">
              {filteredMembers.map((member) => (
                <button
                  key={member.id}
                  onClick={() => handleSelect(member)}
                  className="w-full px-3 py-2 text-left hover:bg-gray-100 border-b last:border-b-0"
                >
                  <div className="font-semibold text-sm">{member.name}</div>
                  <div className="text-xs text-gray-600">{member.email}</div>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
