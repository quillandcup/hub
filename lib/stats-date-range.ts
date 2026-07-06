export const MIN_DATE = "2026-01-01"

export function todayDate(now = new Date()): string {
  return now.toISOString().slice(0, 10)
}

export function ytdStart(now = new Date()): string {
  return `${now.getFullYear()}-01-01`
}

export function qtdStart(now = new Date()): string {
  const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3
  return `${now.getFullYear()}-${String(quarterStartMonth + 1).padStart(2, "0")}-01`
}

export function mtdStart(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`
}

export function resolveDateRange(
  params: { from?: string; to?: string },
  now = new Date()
): { from: string; to: string; since: string; until: string } {
  const today = todayDate(now)
  const ytd = ytdStart(now)
  const defaultFrom = ytd >= MIN_DATE ? ytd : MIN_DATE

  const from = params.from && params.from >= MIN_DATE ? params.from : defaultFrom
  const to = params.to && params.to <= today ? params.to : today

  return {
    from,
    to,
    since: `${from}T00:00:00Z`,
    until: `${to}T23:59:59Z`,
  }
}
