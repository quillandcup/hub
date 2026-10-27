'use client'

import { exitSudo } from '@/app/actions/sudo'
import AnnouncementBar from '@/components/announcements/AnnouncementBar'

interface SudoBannerProps {
  memberName: string
  memberEmail: string
}

export default function SudoBanner({ memberName, memberEmail }: SudoBannerProps) {
  return (
    <AnnouncementBar
      tone="critical"
      aria-label="Sudo mode"
      action={{ label: 'Exit Sudo', track: 'sudo-exit', formAction: exitSudo }}
    >
      <span className="font-medium">
        Viewing as <strong>{memberName}</strong> ({memberEmail})
      </span>
    </AnnouncementBar>
  )
}
