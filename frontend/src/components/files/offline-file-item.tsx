import { DownloadIcon, FileAudioIcon, PlayIcon, TextIcon, Trash2Icon } from "lucide-react"
import { Link } from "react-router-dom"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatBytes, formatDuration, formatRelativeDate } from "@/lib/format"
import { getOfflineBundle, removeOfflineBundle, type OfflineFileRecord } from "@/lib/offline-db"
import {
  cleanedTranscriptDownloadName,
  downloadBlob,
  downloadTextFile,
  transcriptDownloadName,
} from "@/lib/transcript"

export function OfflineFileItem({ file }: { file: OfflineFileRecord }) {
  const remove = async () => {
    await removeOfflineBundle(file.id)
    toast.success("Offline copy removed.")
  }

  const downloadAudio = () => {
    downloadBlob(file.audioBlob, file.name)
  }

  const downloadCleaned = async () => {
    const bundle = await getOfflineBundle(file.id)
    const text = bundle?.transcript?.cleanedText ?? ""
    if (!text) return toast.error("Cleaned text is not available in this offline copy.")
    downloadTextFile(text, cleanedTranscriptDownloadName(file.name))
  }

  const downloadEdited = async () => {
    const bundle = await getOfflineBundle(file.id)
    const text = bundle?.editedText ?? ""
    if (!text) return toast.error("Edited text is not available in this offline copy.")
    downloadTextFile(text, transcriptDownloadName(file.name))
  }

  return (
    <div className="rounded-xl border bg-card p-4 shadow-xs">
      <div className="flex gap-3">
        <div className="bg-muted flex size-10 shrink-0 items-center justify-center rounded-lg">
          <FileAudioIcon className="text-muted-foreground size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium" title={file.name}>{file.name}</p>
              <p className="text-muted-foreground mt-1 text-xs">
                {formatDuration(file.durationSeconds)} · {formatBytes(file.sizeBytes)} · saved {formatRelativeDate(file.savedAt)}
              </p>
            </div>
            <Badge variant="secondary">Offline</Badge>
          </div>

          {file.description ? <p className="text-muted-foreground mt-2 line-clamp-2 text-sm">{file.description}</p> : null}
          {file.tags.length ? <div className="mt-2 flex flex-wrap gap-1.5">{file.tags.map((tag) => <Badge key={tag} variant="outline" className="font-normal">{tag}</Badge>)}</div> : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline"><Link to={`/player/${file.id}`}><PlayIcon />Play / Edit</Link></Button>
            <Button asChild size="sm"><Link to={`/text/${file.jobId}`}><TextIcon />View text</Link></Button>
            <Button size="sm" variant="outline" onClick={downloadAudio}><DownloadIcon />Audio</Button>
            <Button size="sm" variant="outline" onClick={() => void downloadCleaned()}><DownloadIcon />Cleaned text</Button>
            <Button size="sm" variant="outline" onClick={() => void downloadEdited()}><DownloadIcon />Edited text</Button>
            <Button size="sm" variant="ghost" onClick={() => void remove()}><Trash2Icon />Remove offline</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
