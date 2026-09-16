import type { LucideIcon } from "lucide-react"

export function StatCard({ label, value, note, icon: Icon }: { label: string; value: string; note?: string; icon: LucideIcon }) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-xs">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-muted-foreground text-xs font-medium">{label}</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
          {note ? <p className="text-muted-foreground mt-1 text-xs">{note}</p> : null}
        </div>
        <div className="bg-muted flex size-9 items-center justify-center rounded-lg"><Icon className="text-muted-foreground size-4" /></div>
      </div>
    </div>
  )
}
