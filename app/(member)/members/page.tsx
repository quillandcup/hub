import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getCurrentUser } from "@/lib/auth"
import { getEffectiveIdentity } from "@/lib/sudo"
import { getMemberDisplayName } from "@/lib/member-display-name"
import { safeUrl } from "@/lib/url"
import type { DirectoryEntry } from "@/lib/member-directory"
import MemberDirectory from "./MemberDirectory"

export const metadata: Metadata = {
  title: "Member Directory",
}

const BATCH_SIZE = 1000

interface DirectoryRow {
  id: string
  name: string
  display_name: string | null
  photo_url: string | null
  bio: string | null
  first_joined_at: string | null
  projects: string[] | null
  topics: string[] | null
}

export default async function MemberDirectoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>
}) {
  const user = await getCurrentUser()
  if (!user) redirect("/login")
  const effectiveIdentity = await getEffectiveIdentity(user)
  if (!effectiveIdentity) redirect("/admin")

  const { q } = await searchParams
  const initialQuery = typeof q === "string" ? q : ""

  const supabase = await createClient()

  // get_member_directory returns only current members' public fields (see its migration).
  // Paginated per CLAUDE.md -- the membership can pass 1000.
  let rows: DirectoryRow[] = []
  let offset = 0
  let hasMore = true
  while (hasMore) {
    const { data, error } = await supabase.rpc("get_member_directory").range(offset, offset + BATCH_SIZE - 1)
    if (error) {
      console.error("[member-directory] get_member_directory failed", error)
      throw new Error("Couldn't load the member directory")
    }
    const batch = (data ?? []) as DirectoryRow[]
    rows = rows.concat(batch)
    offset += batch.length
    hasMore = batch.length === BATCH_SIZE
  }

  // The viewer's own private notes, so they can search them too. Skipped in sudo: RLS would
  // return the admin's notes, not the sudo'd member's (see members/[id]/noteActions.ts).
  const notesBySubject = new Map<string, string>()
  if (!effectiveIdentity.isSudo) {
    const { data: notes } = await supabase
      .from("member_notes")
      .select("subject_member_id, body")
      .eq("author_member_id", effectiveIdentity.memberId)
    for (const n of notes ?? []) notesBySubject.set(n.subject_member_id, n.body)
  }

  const entries: DirectoryEntry[] = rows
    .map((row) => ({
      id: row.id,
      displayName: getMemberDisplayName(row),
      photoUrl: safeUrl(row.photo_url),
      bio: row.bio,
      firstJoinedAt: row.first_joined_at,
      projects: row.projects ?? [],
      topics: row.topics ?? [],
      myNote: notesBySubject.get(row.id) ?? null,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "en", { sensitivity: "base" }))

  return (
    <div className="container mx-auto px-6 py-8 max-w-5xl">
      <h1 className="text-3xl font-bold mb-1">Member Directory</h1>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
        Find a Hedgie by name, what they&apos;re writing, or what they&apos;re happy to chat about.
      </p>
      <MemberDirectory
        entries={entries}
        initialQuery={initialQuery}
        viewerMemberId={effectiveIdentity.memberId}
      />
    </div>
  )
}
