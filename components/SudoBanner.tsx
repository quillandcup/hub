'use client'

import { exitSudo } from '@/app/actions/sudo'

interface SudoBannerProps {
  memberName: string
  memberEmail: string
}

export default function SudoBanner({ memberName, memberEmail }: SudoBannerProps) {
  return (
    <div className="bg-red-600 text-white px-6 py-2 flex items-center justify-between flex-shrink-0 z-40">
      <span className="text-sm font-medium">
        Viewing as <strong>{memberName}</strong> ({memberEmail})
      </span>
      <form action={exitSudo}>
        <button
          type="submit"
          className="text-sm font-medium underline hover:no-underline ml-4 cursor-pointer"
        >
          Exit Sudo
        </button>
      </form>
    </div>
  )
}
