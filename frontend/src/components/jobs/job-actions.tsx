import * as React from "react"
import { DownloadIcon, MoreHorizontalIcon, PauseIcon, PlayIcon, RefreshCcwIcon, RotateCcwIcon, SquareIcon, TextIcon } from "lucide-react"
import { Link } from "react-router-dom"
import { toast } from "sonner"

import { cancelJob, pauseJob, recleanJob, resumeJob, retryJob } from "@/api/jobs"
import { artifactDownloadUrl } from "@/api/artifacts"
import { useAppData } from "@/app/app-data-provider"
import { ConfirmDialog } from "@/components/common/confirm-dialog"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { finalTextArtifact, preferredTextArtifact } from "@/lib/artifacts"
import { normalizeApiError } from "@/api/client"
import type { Job } from "@/types/api"

export function JobActions({ job, compact = false }: { job: Job; compact?: boolean }) {
  const { setJob } = useAppData()
  const [busy, setBusy] = React.useState(false)
  const [confirmCancel, setConfirmCancel] = React.useState(false)
  const [confirmReclean, setConfirmReclean] = React.useState(false)
  const textArtifact = preferredTextArtifact(job)
  const finalArtifact = finalTextArtifact(job)

  const run = async (action: () => Promise<Job>, success?: string) => {
    setBusy(true)
    try {
      const updated = await action()
      setJob(updated)
      if (success) toast.success(success)
    } catch (error) {
      toast.error(normalizeApiError(error).message)
    } finally {
      setBusy(false)
    }
  }

  const canPause = !job.is_paused && !["completed", "cancelled", "failed"].includes(job.status)
  const canResume = job.is_paused && !["completed", "cancelled"].includes(job.status)
  const canCancel = !["completed", "cancelled"].includes(job.status)
  const canRetry = ["failed", "cancelled"].includes(job.status)
  const hasNormalizedTranscript = job.artifacts.some((artifact) => artifact.kind === "subtitle_normalized_json")
  const cleaningBusy = job.tasks.some(
    (task) => task.kind === "clean_text" && ["queued", "retry_wait", "claimed", "running"].includes(task.status),
  )
  const canReclean = hasNormalizedTranscript && !cleaningBusy

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {textArtifact ? (
          <Button asChild size={compact ? "sm" : "default"} variant={finalArtifact ? "default" : "secondary"}>
            <Link to={`/text/${job.id}`}><TextIcon />View text</Link>
          </Button>
        ) : null}
        {textArtifact ? (
          <Button asChild size={compact ? "sm" : "default"} variant="outline">
            <a href={artifactDownloadUrl(textArtifact.id)}><DownloadIcon />Download</a>
          </Button>
        ) : null}
        {!textArtifact && job.source_available ? (
          <Button asChild size={compact ? "sm" : "default"} variant="outline">
            <Link to={`/player/${job.id}`}><PlayIcon />Play</Link>
          </Button>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size={compact ? "icon-sm" : "icon"} disabled={busy} aria-label="More job actions">
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {job.source_available ? <DropdownMenuItem asChild><Link to={`/player/${job.id}`}><PlayIcon />Open player</Link></DropdownMenuItem> : null}
            {textArtifact ? <DropdownMenuItem asChild><Link to={`/text/${job.id}`}><TextIcon />Open text</Link></DropdownMenuItem> : null}
            {(job.source_available || textArtifact) ? <DropdownMenuSeparator /> : null}
            {canPause ? <DropdownMenuItem onSelect={() => void run(() => pauseJob(job.id))}><PauseIcon />Pause</DropdownMenuItem> : null}
            {canResume ? <DropdownMenuItem onSelect={() => void run(() => resumeJob(job.id))}><RotateCcwIcon />Resume</DropdownMenuItem> : null}
            {canRetry ? <DropdownMenuItem onSelect={() => void run(() => retryJob(job.id), "Job queued again.")}><RefreshCcwIcon />Retry</DropdownMenuItem> : null}
            {canReclean ? <DropdownMenuItem onSelect={() => setConfirmReclean(true)}><RefreshCcwIcon />Re-clean transcript</DropdownMenuItem> : null}
            {canCancel ? <><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onSelect={() => setConfirmCancel(true)}><SquareIcon />Cancel</DropdownMenuItem></> : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ConfirmDialog
        open={confirmReclean}
        onOpenChange={setConfirmReclean}
        title="Run cleanup again?"
        description="Cleanup will run again from the normalized transcript. Audio will not be retranscribed, and the current cleaned files stay available until the new cleanup succeeds."
        confirmLabel="Re-clean transcript"
        busy={busy}
        onConfirm={async () => {
          await run(() => recleanJob(job.id), "Cleanup queued again.")
          setConfirmReclean(false)
        }}
      />

      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="Cancel this job?"
        description="The current safe processing step will stop and the job will be marked as cancelled. Existing transcript files are kept."
        confirmLabel="Cancel job"
        destructive
        busy={busy}
        onConfirm={async () => {
          await run(() => cancelJob(job.id), "Cancellation requested.")
          setConfirmCancel(false)
        }}
      />
    </>
  )
}
