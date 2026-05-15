'use client'

import { useState } from 'react'
import { startSudo } from '@/app/actions/sudo'
import Modal from '@/components/Modal'
import MemberSearch from '@/components/MemberSearch'

interface Member {
  id: string
  name: string
  email: string
}

interface SudoModalProps {
  isOpen: boolean
  onClose: () => void
  members: Member[]
}

export default function SudoModal({ isOpen, onClose, members }: SudoModalProps) {
  const [selectedMember, setSelectedMember] = useState<Member | null>(null)
  const [isPending, setIsPending] = useState(false)

  async function handleConfirm() {
    if (!selectedMember) return
    setIsPending(true)
    try {
      await startSudo(selectedMember.id)
    } finally {
      setIsPending(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="View As Member" maxWidth="md">
      <div className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Select a member to view the portal as them.
        </p>
        <MemberSearch
          members={members}
          selectedMemberId={selectedMember?.id ?? null}
          onSelect={setSelectedMember}
          placeholder="Search by name or email..."
        />
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!selectedMember || isPending}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isPending ? 'Switching...' : 'View As Member'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
