import * as React from "react"
import { FileAudioIcon, UploadCloudIcon, XIcon } from "lucide-react"
import { toast } from "sonner"

import { normalizeApiError } from "@/api/client"
import { uploadJobs } from "@/api/jobs"
import { useAppData } from "@/app/app-data-provider"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { formatBytes } from "@/lib/format"
import { cn } from "@/lib/utils"

const ACCEPT = ".mp3,.wav,.m4a,.aac,.flac,.ogg,.opus,.webm,.mp4,audio/*,video/mp4"

export function UploadZone() {
  const { refreshJobs } = useAppData()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [files, setFiles] = React.useState<File[]>([])
  const [dragging, setDragging] = React.useState(false)
  const [uploading, setUploading] = React.useState(false)
  const [uploadProgress, setUploadProgress] = React.useState(0)

  const addFiles = (incoming: FileList | File[]) => {
    const next = Array.from(incoming)
    setFiles((current) => {
      const seen = new Set(current.map((file) => `${file.name}:${file.size}:${file.lastModified}`))
      return [...current, ...next.filter((file) => !seen.has(`${file.name}:${file.size}:${file.lastModified}`))]
    })
  }

  const startUpload = async () => {
    if (!files.length) return
    setUploading(true)
    setUploadProgress(0)
    try {
      await uploadJobs(files, { onProgress: setUploadProgress })
      toast.success(files.length === 1 ? "Audio added." : `${files.length} audio files added.`)
      setFiles([])
      await refreshJobs()
    } catch (error) {
      toast.error(normalizeApiError(error).message)
    } finally {
      setUploading(false)
      setUploadProgress(0)
    }
  }

  return (
    <div className="space-y-3">
      <input ref={inputRef} type="file" multiple accept={ACCEPT} className="hidden" onChange={(event) => event.target.files && addFiles(event.target.files)} />
      <button
        type="button"
        className={cn(
          "hover:bg-accent/30 flex min-h-48 w-full flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition-colors",
          dragging && "bg-accent border-foreground/30",
        )}
        onClick={() => inputRef.current?.click()}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true) }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => { event.preventDefault(); if (event.currentTarget === event.target) setDragging(false) }}
        onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles(event.dataTransfer.files) }}
        disabled={uploading}
      >
        <div className="bg-primary text-primary-foreground mb-4 flex size-11 items-center justify-center rounded-full">
          <UploadCloudIcon className="size-5" />
        </div>
        <p className="font-medium">Choose audio files</p>
        <p className="text-muted-foreground mt-1 text-sm">Tap here or drop recordings into this area.</p>
        <p className="text-muted-foreground mt-3 text-xs">MP3, WAV, M4A, AAC, FLAC, OGG, Opus, WebM and MP4</p>
      </button>

      {files.length ? (
        <div className="rounded-xl border bg-card p-3">
          <div className="max-h-40 space-y-1 overflow-y-auto">
            {files.map((file, index) => (
              <div key={`${file.name}:${file.size}:${file.lastModified}`} className="flex items-center gap-3 rounded-lg px-2 py-2">
                <FileAudioIcon className="text-muted-foreground size-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{file.name}</p>
                  <p className="text-muted-foreground text-xs">{formatBytes(file.size)}</p>
                </div>
                <Button variant="ghost" size="icon-sm" aria-label={`Remove ${file.name}`} disabled={uploading} onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                  <XIcon />
                </Button>
              </div>
            ))}
          </div>
          {uploading ? <div className="mt-3 space-y-2 px-2"><Progress value={uploadProgress} /><p className="text-muted-foreground text-center text-xs">Uploading {uploadProgress}%</p></div> : null}
          <Button className="mt-3 w-full" size="lg" onClick={() => void startUpload()} disabled={uploading}>
            <UploadCloudIcon />{uploading ? "Uploading…" : files.length === 1 ? "Start transcription" : `Start ${files.length} transcriptions`}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
