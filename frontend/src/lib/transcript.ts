import type { SubtitleCue } from "@/types/api"

export function cueDisplayText(cue: SubtitleCue, edits: Record<string, string>) {
  return edits[cue.id] ?? cue.text
}

export function cuesToPlainText(cues: SubtitleCue[], edits: Record<string, string> = {}) {
  const paragraphs: string[] = []
  let current: string[] = []

  for (const cue of cues) {
    const text = (edits[cue.id] ?? cue.text).trim()
    if (text) current.push(text)

    if (cue.paragraph_after && current.length) {
      paragraphs.push(current.join(" "))
      current = []
    }
  }

  if (current.length) paragraphs.push(current.join(" "))
  return paragraphs.join("\n\n")
}

export function cleanedTranscriptDownloadName(sourceName: string) {
  const base = sourceName.replace(/\.[^.]+$/, "") || "transcript"
  return `${base}-cleaned.txt`
}

export function transcriptDownloadName(sourceName: string) {
  const base = sourceName.replace(/\.[^.]+$/, "") || "transcript"
  return `${base}-edited.txt`
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadTextFile(text: string, filename: string) {
  downloadBlob(
    new Blob(["\uFEFF", text], { type: "text/plain;charset=utf-8" }),
    filename,
  )
}
