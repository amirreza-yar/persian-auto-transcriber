import * as React from "react"
import { DownloadIcon, FileAudioIcon, MoreHorizontalIcon, PencilIcon, PlayIcon, RefreshCcwIcon, TextIcon, Trash2Icon } from "lucide-react"
import { Link } from "react-router-dom"
import { toast } from "sonner"

import { artifactDownloadUrl } from "@/api/artifacts"
import { recleanJob } from "@/api/jobs"
import { normalizeApiError } from "@/api/client"
import { audioDownloadUrl, deleteSourceAudio } from "@/api/files"
import { useAppData } from "@/app/app-data-provider"
import { ConfirmDialog } from "@/components/common/confirm-dialog"
import { FileMetadataDialog } from "@/components/files/file-metadata-dialog"
import { JobStatus } from "@/components/jobs/job-status"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { preferredTextArtifact } from "@/lib/artifacts"
import { formatBytes, formatDuration, formatRelativeDate } from "@/lib/format"
import { removeOfflineBundle } from "@/lib/offline-db"
import { saveFileForOffline } from "@/lib/offline-sync"
import type { AudioFile, Job } from "@/types/api"

export function FileItem({
  file,
  job,
  offlineSaved = false,
  onFileUpdated,
  onSourceDeleted,
  onOfflineChanged,
}: {
  file: AudioFile
  job?: Job
  offlineSaved?: boolean
  onFileUpdated: (file: AudioFile) => void
  onSourceDeleted: (fileId: string) => void
  onOfflineChanged?: () => void
}) {
  const { refreshJobs } = useAppData()
  const [metadataOpen, setMetadataOpen] = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [recleanOpen, setRecleanOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [offlineBusy, setOfflineBusy] = React.useState(false)
  const textArtifact = job ? preferredTextArtifact(job) : null

  const deleteAudio = async () => {
    setBusy(true)
    try {
      await deleteSourceAudio(file.id)
      onSourceDeleted(file.id)
      await refreshJobs()
      setDeleteOpen(false)
      toast.success("Source audio deleted. Transcript files were kept.")
    } catch (error) {
      toast.error(normalizeApiError(error).message)
    } finally {
      setBusy(false)
    }
  }

  const toggleOffline = async () => {
    if (!job) return
    setOfflineBusy(true)
    try {
      if (offlineSaved) {
        await removeOfflineBundle(file.id)
        toast.success("Offline copy removed.")
      } else {
        await saveFileForOffline(file, job)
        toast.success("Audio, cleaned text and edited text saved for offline use.")
      }
      onOfflineChanged?.()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update offline copy.")
    } finally {
      setOfflineBusy(false)
    }
  }

  const canSaveOffline = file.source_available && job?.status === "completed"
  const hasNormalizedTranscript = job?.artifacts.some((artifact) => artifact.kind === "subtitle_normalized_json") ?? false
  const cleaningBusy = job?.tasks.some(
    (task) => task.kind === "clean_text" && ["queued", "retry_wait", "claimed", "running"].includes(task.status),
  ) ?? false
  const canReclean = Boolean(job && hasNormalizedTranscript && !cleaningBusy)

  const reclean = async () => {
    if (!job) return
    setBusy(true)
    try {
      await recleanJob(job.id)
      await refreshJobs()
      setRecleanOpen(false)
      toast.success("Cleanup queued again.")
    } catch (error) {
      toast.error(normalizeApiError(error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="rounded-xl border bg-card p-4 shadow-xs">
        <div className="flex gap-3">
          <div className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-lg">
            <FileAudioIcon className="text-muted-foreground size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium" title={file.name}>{file.name}</p>
                <p className="text-muted-foreground mt-1 text-xs">{formatDuration(file.duration_seconds)} · {formatBytes(file.size_bytes)} · {formatRelativeDate(file.created_at)}</p>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button size="icon-sm" variant="ghost" aria-label="File actions"><MoreHorizontalIcon /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setMetadataOpen(true)}><PencilIcon />Edit details</DropdownMenuItem>
                  {canSaveOffline ? <DropdownMenuItem disabled={offlineBusy} onSelect={() => void toggleOffline()}><DownloadIcon />{offlineSaved ? "Remove offline copy" : "Save for offline"}</DropdownMenuItem> : null}
                  {canReclean ? <DropdownMenuItem disabled={busy} onSelect={() => setRecleanOpen(true)}><RefreshCcwIcon />Re-clean transcript</DropdownMenuItem> : null}
                  {file.source_available ? <DropdownMenuItem asChild><a href={audioDownloadUrl(file.id)}><DownloadIcon />Download audio</a></DropdownMenuItem> : null}
                  {file.source_available && ["completed", "cancelled"].includes(file.job_status) ? <><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}><Trash2Icon />Delete source audio</DropdownMenuItem></> : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {file.description ? <p className="text-muted-foreground mt-2 line-clamp-2 text-sm">{file.description}</p> : null}
            {file.tags.length ? <div className="mt-2 flex flex-wrap gap-1.5">{file.tags.map((tag) => <Badge key={tag} variant="outline" className="font-normal">{tag}</Badge>)}</div> : null}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {job ? <JobStatus job={job} compact /> : <Badge variant="outline">{file.job_status}</Badge>}
              {offlineSaved ? <Badge variant="secondary">Available offline</Badge> : null}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {file.source_available || offlineSaved ? <Button asChild size="sm" variant="outline"><Link to={`/player/${file.id}`}><PlayIcon />Play</Link></Button> : null}
              {textArtifact || offlineSaved ? <Button asChild size="sm"><Link to={`/text/${file.job_id}`}><TextIcon />View text</Link></Button> : null}
              {textArtifact ? <Button asChild size="sm" variant="outline"><a href={artifactDownloadUrl(textArtifact.id)}><DownloadIcon />Download text</a></Button> : null}
            </div>
          </div>
        </div>
      </div>

      <FileMetadataDialog file={file} open={metadataOpen} onOpenChange={setMetadataOpen} onUpdated={onFileUpdated} />
      <ConfirmDialog open={recleanOpen} onOpenChange={setRecleanOpen} title="Run cleanup again?" description="Cleanup will run again from the normalized transcript. Audio will not be retranscribed, and the current cleaned files stay available until the new cleanup succeeds." confirmLabel="Re-clean transcript" busy={busy} onConfirm={reclean} />
      <ConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} title="Delete the source audio?" description="The original recording will be removed from the server. Existing transcript and subtitle files will stay available." confirmLabel="Delete audio" destructive busy={busy} onConfirm={deleteAudio} />
    </>
  )
}
