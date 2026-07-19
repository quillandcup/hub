import { etHour, etDow } from "@/lib/community-stats"

const DOW_ORDER = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

export type SlackMessageRow = {
  channel_id: string
  channel_name: string | null
  occurred_at: string
  deleted_at: string | null
  user_id: string
  thread_ts: string | null
}

export type SlackReactionRow = {
  channel_id: string
  channel_name: string | null
  occurred_at: string
  removed_at: string | null
  user_id: string
  reaction: string
}

export type SlackChannelRow = {
  channel_id: string
  name: string
  is_archived: boolean
  is_private: boolean
  member_count: number | null
  created: string | null
}

export type ChannelActivityRow = {
  channel_id: string
  occurred_at: string
}

export interface HeatCell {
  day: string
  hour: number
  count: number
}

export function computeDayHourHeatmap(
  messages: SlackMessageRow[],
  reactions: SlackReactionRow[]
): HeatCell[] {
  const grid = new Map<string, number>()
  for (const m of messages) {
    const key = `${etDow(m.occurred_at)}-${etHour(m.occurred_at)}`
    grid.set(key, (grid.get(key) ?? 0) + 1)
  }
  for (const r of reactions) {
    const key = `${etDow(r.occurred_at)}-${etHour(r.occurred_at)}`
    grid.set(key, (grid.get(key) ?? 0) + 1)
  }

  const cells: HeatCell[] = []
  for (const day of DOW_ORDER) {
    for (let hour = 0; hour < 24; hour++) {
      cells.push({ day: day.slice(0, 3), hour, count: grid.get(`${day}-${hour}`) ?? 0 })
    }
  }
  return cells
}

export interface HeroStats {
  totalMessages: number
  totalReactions: number
  activeChannels: number
  activeUsers: number
  busiestDay: string
  busiestHour: number
  threadReplyPct: number
}

export function computeHeroStats(
  messages: SlackMessageRow[],
  reactions: SlackReactionRow[]
): HeroStats {
  const dayCounts = new Map<string, number>()
  const hourCounts = new Map<number, number>()
  const channels = new Set<string>()
  const users = new Set<string>()
  let threadReplies = 0

  for (const m of messages) {
    const day = etDow(m.occurred_at)
    const hour = etHour(m.occurred_at)
    dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1)
    hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + 1)
    channels.add(m.channel_id)
    users.add(m.user_id)
    if (m.thread_ts) threadReplies++
  }
  for (const r of reactions) {
    const day = etDow(r.occurred_at)
    const hour = etHour(r.occurred_at)
    dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1)
    hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + 1)
    channels.add(r.channel_id)
    users.add(r.user_id)
  }

  let busiestDay = DOW_ORDER[0]
  let busiestDayCount = -1
  for (const [day, count] of dayCounts) {
    if (count > busiestDayCount) {
      busiestDay = day
      busiestDayCount = count
    }
  }

  let busiestHour = 0
  let busiestHourCount = -1
  for (const [hour, count] of hourCounts) {
    if (count > busiestHourCount) {
      busiestHour = hour
      busiestHourCount = count
    }
  }

  return {
    totalMessages: messages.length,
    totalReactions: reactions.length,
    activeChannels: channels.size,
    activeUsers: users.size,
    busiestDay,
    busiestHour,
    threadReplyPct: messages.length > 0 ? Math.round((threadReplies / messages.length) * 100) : 0,
  }
}

export interface ChannelEngagement {
  channelId: string
  name: string
  messages: number
  reactions: number
  threadReplies: number
  uniqueUsers: number
  peakDay: string
  peakHour: number
  lastActivity: string | null
  memberCount: number | null
  isPrivate: boolean
  sparkline: number[]
}

const SPARKLINE_BUCKETS = 20

export function computeChannelEngagement(
  messages: SlackMessageRow[],
  reactions: SlackReactionRow[],
  channels: SlackChannelRow[],
  since: string,
  until: string,
  limit = 15
): ChannelEngagement[] {
  const channelById = new Map(channels.map((c) => [c.channel_id, c]))

  const sinceMs = new Date(since).getTime()
  const untilMs = new Date(until).getTime()
  const bucketWidth = Math.max(1, (untilMs - sinceMs) / SPARKLINE_BUCKETS)

  function bucketIndex(occurredAt: string): number {
    const idx = Math.floor((new Date(occurredAt).getTime() - sinceMs) / bucketWidth)
    return Math.min(SPARKLINE_BUCKETS - 1, Math.max(0, idx))
  }

  type Acc = {
    name: string
    messages: number
    reactions: number
    threadReplies: number
    users: Set<string>
    dayCounts: Map<string, number>
    hourCounts: Map<number, number>
    lastActivity: string | null
    sparkline: number[]
  }
  const acc = new Map<string, Acc>()

  function getAcc(channelId: string, channelName: string | null): Acc {
    let a = acc.get(channelId)
    if (!a) {
      a = {
        name: channelById.get(channelId)?.name ?? channelName ?? channelId,
        messages: 0,
        reactions: 0,
        threadReplies: 0,
        users: new Set(),
        dayCounts: new Map(),
        hourCounts: new Map(),
        lastActivity: null,
        sparkline: new Array(SPARKLINE_BUCKETS).fill(0),
      }
      acc.set(channelId, a)
    }
    return a
  }

  for (const m of messages) {
    const a = getAcc(m.channel_id, m.channel_name)
    a.messages++
    if (m.thread_ts) a.threadReplies++
    a.users.add(m.user_id)
    const day = etDow(m.occurred_at)
    const hour = etHour(m.occurred_at)
    a.dayCounts.set(day, (a.dayCounts.get(day) ?? 0) + 1)
    a.hourCounts.set(hour, (a.hourCounts.get(hour) ?? 0) + 1)
    a.sparkline[bucketIndex(m.occurred_at)]++
    if (!a.lastActivity || m.occurred_at > a.lastActivity) a.lastActivity = m.occurred_at
  }
  for (const r of reactions) {
    const a = getAcc(r.channel_id, r.channel_name)
    a.reactions++
    a.users.add(r.user_id)
    const day = etDow(r.occurred_at)
    const hour = etHour(r.occurred_at)
    a.dayCounts.set(day, (a.dayCounts.get(day) ?? 0) + 1)
    a.hourCounts.set(hour, (a.hourCounts.get(hour) ?? 0) + 1)
    a.sparkline[bucketIndex(r.occurred_at)]++
    if (!a.lastActivity || r.occurred_at > a.lastActivity) a.lastActivity = r.occurred_at
  }

  function topKey<T>(counts: Map<T, number>, fallback: T): T {
    let best = fallback
    let bestCount = -1
    for (const [key, count] of counts) {
      if (count > bestCount) {
        best = key
        bestCount = count
      }
    }
    return best
  }

  return Array.from(acc.entries())
    .map(([channelId, a]) => {
      const channel = channelById.get(channelId)
      return {
        channelId,
        name: a.name,
        messages: a.messages,
        reactions: a.reactions,
        threadReplies: a.threadReplies,
        uniqueUsers: a.users.size,
        peakDay: topKey(a.dayCounts, DOW_ORDER[0]).slice(0, 3),
        peakHour: topKey(a.hourCounts, 0),
        lastActivity: a.lastActivity,
        memberCount: channel?.member_count ?? null,
        isPrivate: channel?.is_private ?? false,
        sparkline: a.sparkline,
      }
    })
    .sort((a, b) => b.messages + b.reactions - (a.messages + a.reactions))
    .slice(0, limit)
}

export interface ArchivalCandidate {
  channelId: string
  name: string
  memberCount: number | null
  lastActivity: string | null
  daysSinceActivity: number | null
  totalMessagesAllTime: number
  createdRecently: boolean
}

export function computeArchivalCandidates(
  allTimeActivity: ChannelActivityRow[],
  channels: SlackChannelRow[],
  now: Date,
  thresholdDays = 60,
  graceDays = 30
): ArchivalCandidate[] {
  const messageCount = new Map<string, number>()
  const lastActivity = new Map<string, string>()
  for (const row of allTimeActivity) {
    messageCount.set(row.channel_id, (messageCount.get(row.channel_id) ?? 0) + 1)
    const prev = lastActivity.get(row.channel_id)
    if (!prev || row.occurred_at > prev) lastActivity.set(row.channel_id, row.occurred_at)
  }

  const candidates: ArchivalCandidate[] = []
  for (const c of channels) {
    if (c.is_archived) continue
    const last = lastActivity.get(c.channel_id) ?? null
    const daysSince = last
      ? Math.floor((now.getTime() - new Date(last).getTime()) / (1000 * 60 * 60 * 24))
      : null
    const createdRecently = c.created
      ? now.getTime() - new Date(c.created).getTime() < graceDays * 24 * 60 * 60 * 1000
      : false

    const isStale = daysSince === null ? !createdRecently : daysSince >= thresholdDays
    if (!isStale) continue

    candidates.push({
      channelId: c.channel_id,
      name: c.name,
      memberCount: c.member_count,
      lastActivity: last,
      daysSinceActivity: daysSince,
      totalMessagesAllTime: messageCount.get(c.channel_id) ?? 0,
      createdRecently,
    })
  }

  return candidates.sort((a, b) => {
    if (a.daysSinceActivity === null && b.daysSinceActivity === null) return 0
    if (a.daysSinceActivity === null) return -1
    if (b.daysSinceActivity === null) return 1
    return b.daysSinceActivity - a.daysSinceActivity
  })
}

export interface EmojiEntry {
  emoji: string
  count: number
}

export function computeTopEmoji(reactions: SlackReactionRow[], limit = 10): EmojiEntry[] {
  const counts = new Map<string, number>()
  for (const r of reactions) {
    counts.set(r.reaction, (counts.get(r.reaction) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([emoji, count]) => ({ emoji, count }))
}
