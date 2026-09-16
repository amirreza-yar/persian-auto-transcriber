export function formatDuration(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—"
  const whole = Math.max(0, Math.round(seconds))
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const secs = whole % 60
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
  return `${minutes}:${String(secs).padStart(2, "0")}`
}

export function formatBytes(bytes: number | null | undefined) {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return "—"
  const units = ["B", "KB", "MB", "GB", "TB"]
  let value = Math.max(0, bytes)
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const digits = value >= 10 || unit === 0 ? 0 : 1
  return `${value.toFixed(digits)} ${units[unit]}`
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

export function formatRelativeDate(value: string | null | undefined) {
  if (!value) return "—"
  const date = new Date(value)
  const diffMs = date.getTime() - Date.now()
  if (Number.isNaN(diffMs)) return value
  const minutes = Math.round(diffMs / 60_000)
  if (Math.abs(minutes) < 1) return "just now"
  if (Math.abs(minutes) < 60) return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(minutes, "minute")
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(hours, "hour")
  const days = Math.round(hours / 24)
  if (Math.abs(days) < 14) return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(days, "day")
  return formatDateTime(value)
}

export function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "0%"
  return `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`
}

export function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined) return "—"
  return new Intl.NumberFormat().format(value)
}
