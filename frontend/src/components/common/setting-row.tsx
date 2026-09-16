import type { ReactNode } from "react"

export function SettingRow({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 sm:max-w-[65%]">
        <p className="text-sm font-medium">{title}</p>
        {description ? <p className="text-muted-foreground mt-1 text-xs leading-relaxed">{description}</p> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}
