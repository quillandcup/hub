'use client'

import EntitySearch, { type SearchItem } from '@/components/EntitySearch'
import { memberMatchHint } from '@/lib/search/member-match-hint'

export interface SudoMember {
  id: string
  /** Legal name. */
  name: string
  displayName?: string | null
  /** Set when the member matched through a nickname that isn't otherwise on screen. */
  matchedAlias?: string | null
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

/** The members the last search returned, so a pick hands back the whole member (with its email), not just the row's text. */
let found = new Map<string, SudoMember>()

/** Module-level so EntitySearch gets the same function every render (it re-searches when it changes). */
async function searchMembers(term: string, signal: AbortSignal): Promise<SearchItem[]> {
  const res = await fetch(`/api/members?search=${encodeURIComponent(term)}&limit=${SUDO_SEARCH_LIMIT}`, { signal })
  if (!res.ok) throw new Error(`Search failed (${res.status})`)
  const json = await res.json()
  const members = (json.members ?? []) as SudoMember[]
  found = new Map(members.map((m) => [m.id, m]))
  // The display name leads, with a second line only when it explains why this member matched.
  return members.map((m) => ({
    id: m.id,
    name: m.displayName?.trim() || m.name,
    detail: memberMatchHint([term], { ...m, aliasFor: () => m.matchedAlias ?? undefined }),
  }))
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
      selectedName={selectedMember?.displayName?.trim() || selectedMember?.name}
      selectedDetail={selectedMember?.email}
      onSelect={(item) => onSelect(item ? (found.get(item.id) ?? { id: item.id, name: item.name, email: '' }) : null)}
      placeholder={placeholder}
      ariaLabel="Search members"
      emptyText="No members found"
      autoFocus
    />
  )
}
