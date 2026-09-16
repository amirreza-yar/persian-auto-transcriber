import type { Artifact, Job } from "@/types/api"

const TEXT_PRIORITY = ["final_text", "normalized_text", "raw_text"]

export function findArtifact(job: Job, kind: string) {
  return job.artifacts.find((artifact) => artifact.kind === kind) ?? null
}

export function preferredTextArtifact(job: Job): Artifact | null {
  for (const kind of TEXT_PRIORITY) {
    const artifact = findArtifact(job, kind)
    if (artifact) return artifact
  }
  return null
}

export function finalTextArtifact(job: Job) {
  return findArtifact(job, "final_text")
}

export function hasReadableText(job: Job) {
  return preferredTextArtifact(job) !== null
}
