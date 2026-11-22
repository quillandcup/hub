'use client'

import { useState } from 'react'
import { startRolePreview } from '@/app/actions/staff-preview'
import Modal from '@/components/Modal'
import { PREVIEWABLE_ROLES, PREVIEW_ROLE_LABELS, type PreviewableRole } from '@/lib/staff-preview'

interface PreviewAsModalProps {
  isOpen: boolean
  onClose: () => void
}

/**
 * "Preview as": an admin picks a staff role and looks at the staff area the way that role sees it. The roles come
 * from the registry (`PREVIEWABLE_ROLES`), so a new role appears here without a change to this component.
 */
export default function PreviewAsModal({ isOpen, onClose }: PreviewAsModalProps) {
  const [role, setRole] = useState<PreviewableRole>(PREVIEWABLE_ROLES[0])
  const [isPending, setIsPending] = useState(false)

  async function handleConfirm() {
    setIsPending(true)
    try {
      await startRolePreview(role)
    } finally {
      setIsPending(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Preview as" maxWidth="md">
      <div className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          See the staff area with the pages and buttons of another role. You still read data with your own access.
        </p>
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
          Role
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as PreviewableRole)}
            className="mt-1 block w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm"
          >
            {PREVIEWABLE_ROLES.map((r) => (
              <option key={r} value={r}>
                {PREVIEW_ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
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
            disabled={isPending}
            data-track="user-menu-role-preview"
            className="px-4 py-2 text-sm bg-plum-600 text-white rounded-lg hover:bg-plum-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isPending ? 'Starting...' : 'Start preview'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
