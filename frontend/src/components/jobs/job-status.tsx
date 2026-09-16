import { AlertCircleIcon, CheckCircle2Icon, Clock3Icon, LoaderCircleIcon, PauseCircleIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { getJobDisplayState } from "@/lib/job-state"
import { cn } from "@/lib/utils"
import type { Job } from "@/types/api"

const iconByTone = {
  neutral: Clock3Icon,
  active: LoaderCircleIcon,
  success: CheckCircle2Icon,
  warning: PauseCircleIcon,
  error: AlertCircleIcon,
}

export function JobStatus({ job, compact = false }: { job: Job; compact?: boolean }) {
  const state = getJobDisplayState(job)
  const Icon = iconByTone[state.tone]
  const progress = state.progress === null ? null : Math.round(Math.min(1, Math.max(0, state.progress)) * 100)

  if (compact) {
    return (
      <Badge variant={state.tone === "error" ? "destructive" : state.tone === "success" ? "secondary" : "outline"} className="font-normal">
        <Icon className={cn(state.tone === "active" && "animate-spin")} />
        {state.label}{progress !== null && state.tone === "active" ? ` ${progress}%` : ""}
      </Badge>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <Icon className={cn("size-4 shrink-0", state.tone === "active" && "animate-spin", state.tone === "error" && "text-destructive")} />
          <span className="font-medium">{state.label}</span>
          {progress !== null && state.tone === "active" ? <span className="text-muted-foreground tabular-nums">{progress}%</span> : null}
        </div>
      </div>
      {progress !== null && !["success", "neutral"].includes(state.tone) ? <Progress value={progress} className="h-1.5" /> : null}
      {state.detail ? <p className="text-muted-foreground text-xs">{state.detail}</p> : null}
    </div>
  )
}
