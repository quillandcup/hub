'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import SignOutButton from './SignOutButton'
import SudoModal from './SudoModal'

interface Member {
  id: string
  name: string
  email: string
}

interface UserMenuProps {
  userEmail: string
  isAdmin?: boolean
  isSudo?: boolean
  members?: Member[]
}

export default function UserMenu({
  userEmail,
  isAdmin = false,
  isSudo = false,
  members = [],
}: UserMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isSudoModalOpen, setIsSudoModalOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  return (
    <>
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 px-2 md:px-3 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <div className="w-8 h-8 rounded-full bg-gradient-to-r from-blue-600 to-purple-600 flex items-center justify-center text-white font-semibold text-sm">
            {userEmail.charAt(0).toUpperCase()}
          </div>
          <span className="hidden md:inline text-sm text-slate-700 dark:text-slate-300">{userEmail}</span>
          <svg
            className={`hidden md:block w-4 h-4 text-slate-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {isOpen && (
          <div className="absolute right-0 mt-2 w-56 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 py-1 z-50">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Signed in as</p>
              <p className="text-sm text-slate-500 dark:text-slate-400 truncate">{userEmail}</p>
            </div>

            <Link
              href="/profile"
              className="block px-4 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              onClick={() => setIsOpen(false)}
            >
              Profile
            </Link>

            {isAdmin && !isSudo && (
              <button
                type="button"
                onClick={() => { setIsOpen(false); setIsSudoModalOpen(true) }}
                className="w-full text-left px-4 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              >
                Sudo As...
              </button>
            )}

            <SignOutButton onSignOut={() => setIsOpen(false)} />
          </div>
        )}
      </div>

      {isAdmin && !isSudo && (
        <SudoModal
          isOpen={isSudoModalOpen}
          onClose={() => setIsSudoModalOpen(false)}
          members={members}
        />
      )}
    </>
  )
}
