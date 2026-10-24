'use client'

import EntitySearch, { type SearchItem } from '@/components/EntitySearch'

export interface SudoMember {
  id: string
  name: string
  email: string
}

interface SudoMemberSearchProps {
  selectedMember: SudoMember | null
  onSelect: (member: SudoMember | null) => void
  placeholder?: string
  /** Debounce before hitting the API; exposed for tests. */
  debounceMs?: number
}

export const SUDO_SEARCH_LIMIT = 20

/** Module-level so EntitySearch gets the same function every render (it re-searches when it changes). */
async function searchMembers(term: string, signal: AbortSignal): Promise<SearchItem[]> {
  const res = await fetch(`/api/members?search=${encodeURIComponent(term)}&limit=${SUDO_SEARCH_LIMIT}`, { signal })
  if (!res.ok) throw new Error(`Search failed (${res.status})`)
  const json = await res.json()
  return ((json.members ?? []) as SudoMember[]).map((m) => ({ id: m.id, name: m.name, detail: m.email }))
}

/**
 * Search-as-you-type member picker for the sudo "View As Member" modal: EntitySearch over the
 * admin-only `GET /api/members?search=…&limit=…` endpoint, queried on demand instead of receiving
 * the entire members table as a prop, so the layouts don't have to load and serialize every
 * member on every request.
 */
export default function SudoMemberSearch({
  selectedMember,
  onSelect,
  placeholder = 'Search by name or email...',
  debounceMs = 250,
}: SudoMemberSearchProps) {
  return (
    <EntitySearch
      search={searchMembers}
      debounceMs={debounceMs}
      selectedId={selectedMember?.id ?? null}
      selectedName={selectedMember?.name}
      selectedDetail={selectedMember?.email}
      onSelect={(item) => onSelect(item ? { id: item.id, name: item.name, email: item.detail ?? '' } : null)}
      placeholder={placeholder}
      ariaLabel="Search members"
      emptyText="No members found"
      autoFocus
    />
  )
}
