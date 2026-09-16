import { loadArtifactText } from "@/api/artifacts"
import { audioDownloadUrl } from "@/api/files"
import { getBestSubtitles } from "@/api/subtitles"
import { preferredTextArtifact } from "@/lib/artifacts"
import { getCueEditsForFile, saveOfflineBundle } from "@/lib/offline-db"
import { cuesToPlainText } from "@/lib/transcript"
import type { AudioFile, Job } from "@/types/api"

export async function saveFileForOffline(file: AudioFile, job: Job) {
  if (!file.source_available) throw new Error("The source audio is no longer available on the server.")
  if (job.status !== "completed") throw new Error("Only completed recordings can be saved offline.")

  const response = await fetch(audioDownloadUrl(file.id), {
    cache: "no-store",
    credentials: "same-origin",
  })
  if (!response.ok) throw new Error(`Could not download audio (${response.status})`)

  const audioBlob = await response.blob()
  if (!audioBlob.size) throw new Error("The server returned an empty audio file.")

  const [subtitle, edits] = await Promise.all([
    getBestSubtitles(job.id).catch(() => null),
    getCueEditsForFile(file.id).catch(() => ({} as Record<string, string>)),
  ])

  const artifact = preferredTextArtifact(job)
  let cleanedText = ""

  if (artifact) {
    cleanedText = await loadArtifactText(artifact.id).catch(() => "")
  }
  if (!cleanedText && subtitle?.cues?.length) {
    cleanedText = cuesToPlainText(subtitle.cues)
  }

  if (!cleanedText && !subtitle?.cues?.length) {
    throw new Error("Cleaned transcript data is not available yet.")
  }

  const editedText = subtitle?.cues?.length
    ? cuesToPlainText(subtitle.cues, edits)
    : cleanedText

  return saveOfflineBundle(file, job, audioBlob, subtitle, cleanedText, editedText)
}
