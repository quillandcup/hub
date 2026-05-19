"use client"

import { useState } from "react"

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  }
  return name.slice(0, 2).toUpperCase()
}

function getAvatarColor(name: string): string {
  const colors = [
    "bg-violet-500", "bg-blue-500", "bg-emerald-500",
    "bg-amber-500", "bg-rose-500", "bg-cyan-500",
  ]
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return colors[Math.abs(hash) % colors.length]
}

interface MemberAvatarProps {
  name: string
  photoUrl: string | null
  size?: number
}

export default function MemberAvatar({ name, photoUrl, size = 56 }: MemberAvatarProps) {
  const [imgFailed, setImgFailed] = useState(false)

  if (photoUrl && !imgFailed) {
    return (
      <img
        src={photoUrl}
        alt={name}
        width={size}
        height={size}
        className="rounded-full object-cover flex-shrink-0"
        style={{ width: size, height: size }}
        onError={() => setImgFailed(true)}
      />
    )
  }

  return (
    <div
      className={`rounded-full flex items-center justify-center flex-shrink-0 text-white font-semibold ${getAvatarColor(name)}`}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {getInitials(name)}
    </div>
  )
}
