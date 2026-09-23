'use client'

import { useEffect, useId, useRef, useState } from 'react'

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

/**
 * Search-as-you-type member picker for the sudo "View As Member" modal.
 *
 * Queries the admin-only `GET /api/members?search=…&limit=…` endpoint on
 * demand instead of receiving the entire members table as a prop, so the
 * layouts don't have to load and serialize every member on every request.
 */
export default function SudoMemberSearch({
  selectedMember,
  onSelect,
  placeholder = 'Search by name or email...',
  debounceMs = 250,
}: SudoMemberSearchProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [results, setResults] = useState<SudoMember[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [isFocused, setIsFocused] = useState(false)
  const listboxId = useId()
  const inputRef = useRef<HTMLInputElement>(null)

  const term = searchTerm.trim()

  useEffect(() => {
    if (!term) {
      setResults([])
      setLoading(false)
      setError(null)
      return
    }

    const controller = new AbortController()
    setLoading(true)
    setError(null)
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/members?search=${encodeURIComponent(term)}&limit=${SUDO_SEARCH_LIMIT}`,
          { signal: controller.signal },
        )
        if (!res.ok) throw new Error(`Search failed (${res.status})`)
        const json = await res.json()
        setResults(json.members ?? [])
        setActiveIndex(-1)
      } catch (err) {
        if (controller.signal.aborted) return
        setResults([])
        setError(err instanceof Error ? err.message : 'Search failed')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, debounceMs)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [term, debounceMs])

  function handleSelect(member: SudoMember | null) {
    onSelect(member)
    setSearchTerm('')
    setResults([])
    setActiveIndex(-1)
    if (member === null) {
      // Put the cursor back in the search box after clearing a selection.
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      if (results.length === 0) return
      e.preventDefault()
      setActiveIndex((i) => (i + 1) % results.length)
    } else if (e.key === 'ArrowUp') {
      if (results.length === 0) return
      e.preventDefault()
      setActiveIndex((i) => (i <= 0 ? results.length - 1 : i - 1))
    } else if (e.key === 'Enter') {
      const member = results[activeIndex] ?? (results.length === 1 ? results[0] : undefined)
      if (member) {
        e.preventDefault()
        handleSelect(member)
      }
    } else if (e.key === 'Escape' && searchTerm) {
      // Clear the search rather than letting Escape bubble out.
      e.stopPropagation()
      setSearchTerm('')
    }
  }

  if (selectedMember) {
    return (
      <div className="flex items-center justify-between px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded text-sm text-slate-900 dark:text-slate-100">
        <div className="flex-1 min-w-0">
          <div className="truncate font-medium">{selectedMember.name}</div>
          <div className="truncate text-xs text-slate-500 dark:text-slate-400">{selectedMember.email}</div>
        </div>
        <button
          type="button"
          onClick={() => handleSelect(null)}
          className="ml-2 text-gray-400 hover:text-gray-600 dark:text-slate-500 dark:hover:text-slate-300"
          title="Clear selection"
          aria-label="Clear selection"
        >
          ✕
        </button>
      </div>
    )
  }

  const showDropdown = isFocused && term.length > 0

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label="Search members"
        aria-expanded={showDropdown && results.length > 0}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
        autoFocus
        placeholder={placeholder}
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setTimeout(() => setIsFocused(false), 200)}
        onKeyDown={handleKeyDown}
        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded text-sm text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-800 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      {showDropdown && (
        <div className="absolute z-10 w-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {loading && results.length === 0 ? (
            <div className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400" role="status">
              Searching...
            </div>
          ) : error ? (
            <div className="px-3 py-2 text-sm text-red-600 dark:text-red-400" role="alert">
              {error}
            </div>
          ) : results.length === 0 && !loading ? (
            <div className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400">
              No members found
            </div>
          ) : (
            <ul id={listboxId} role="listbox" aria-busy={loading}>
              {results.map((member, i) => (
                <li
                  key={member.id}
                  id={`${listboxId}-${i}`}
                  role="option"
                  aria-selected={i === activeIndex}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleSelect(member)}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={`cursor-pointer px-3 py-2 border-b border-slate-100 dark:border-slate-700 last:border-b-0 ${
                    i === activeIndex ? 'bg-gray-100 dark:bg-slate-700' : ''
                  }`}
                >
                  <div className="font-semibold text-sm text-slate-900 dark:text-slate-100">{member.name}</div>
                  <div className="text-xs text-gray-600 dark:text-slate-400">{member.email}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
