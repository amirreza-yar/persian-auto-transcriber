import { cuesToPlainText } from "@/lib/transcript"
import type { AudioFile, Job, SubtitleCue, SubtitlePayload } from "@/types/api"

const DB_NAME = "persian-stt-offline"
const DB_VERSION = 2
const FILES_STORE = "offlineFiles"
const TRANSCRIPTS_STORE = "transcripts"
const EDITS_STORE = "cueEdits"
const EDITED_TEXT_STORE = "editedTexts"

export const OFFLINE_LIBRARY_EVENT = "persian-stt:offline-library-changed"

export interface OfflineFileRecord {
  id: string
  jobId: string
  batchId: string
  name: string
  durationSeconds: number | null
  sizeBytes: number
  mimeType: string | null
  description: string | null
  tags: string[]
  savedAt: string
  audioBlob: Blob
}

export interface OfflineTranscriptRecord {
  fileId: string
  jobId: string
  version: string
  sourceName: string
  cleanedText: string
  cues: SubtitleCue[]
  savedAt: string
}

export interface CueEditRecord {
  key: string
  fileId: string
  jobId: string
  cueId: string
  text: string
  updatedAt: string
}

export interface EditedTextRecord {
  fileId: string
  jobId: string
  text: string
  updatedAt: string
}

export interface OfflineBundle {
  file: OfflineFileRecord
  transcript: OfflineTranscriptRecord | null
  edits: Record<string, string>
  editedText: string
}

function emitLibraryChange() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(OFFLINE_LIBRARY_EVENT))
  }
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"))
  })
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"))
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"))
  })
}

let dbPromise: Promise<IDBDatabase> | null = null

function ensureIndex(store: IDBObjectStore, name: string, keyPath: string) {
  if (!store.indexNames.contains(name)) {
    store.createIndex(name, keyPath, { unique: false })
  }
}

function openDb() {
  if (dbPromise) return dbPromise

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      const tx = request.transaction
      if (!tx) return

      const files = db.objectStoreNames.contains(FILES_STORE)
        ? tx.objectStore(FILES_STORE)
        : db.createObjectStore(FILES_STORE, { keyPath: "id" })
      ensureIndex(files, "jobId", "jobId")
      ensureIndex(files, "savedAt", "savedAt")

      const transcripts = db.objectStoreNames.contains(TRANSCRIPTS_STORE)
        ? tx.objectStore(TRANSCRIPTS_STORE)
        : db.createObjectStore(TRANSCRIPTS_STORE, { keyPath: "fileId" })
      ensureIndex(transcripts, "jobId", "jobId")

      const edits = db.objectStoreNames.contains(EDITS_STORE)
        ? tx.objectStore(EDITS_STORE)
        : db.createObjectStore(EDITS_STORE, { keyPath: "key" })
      ensureIndex(edits, "fileId", "fileId")
      ensureIndex(edits, "jobId", "jobId")

      const editedTexts = db.objectStoreNames.contains(EDITED_TEXT_STORE)
        ? tx.objectStore(EDITED_TEXT_STORE)
        : db.createObjectStore(EDITED_TEXT_STORE, { keyPath: "fileId" })
      ensureIndex(editedTexts, "jobId", "jobId")
    }

    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => {
        db.close()
        dbPromise = null
      }
      resolve(db)
    }

    request.onerror = () => {
      dbPromise = null
      reject(request.error ?? new Error("Could not open IndexedDB"))
    }

    request.onblocked = () => {
      dbPromise = null
      reject(new Error("IndexedDB upgrade is blocked. Close other tabs of the app and try again."))
    }
  })

  return dbPromise
}

export async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist()
  } catch {
    // Persistence is best-effort.
  }
  return false
}

async function assertStorageCapacity(extraBytes: number) {
  try {
    const estimate = await navigator.storage?.estimate?.()
    if (!estimate?.quota || estimate.usage == null) return
    const remaining = estimate.quota - estimate.usage
    if (remaining < extraBytes * 1.1) {
      throw new Error("Not enough browser storage is available to keep this audio offline.")
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Not enough")) throw error
  }
}

export async function saveOfflineBundle(
  file: AudioFile,
  job: Job,
  audioBlob: Blob,
  subtitle: SubtitlePayload | null,
  cleanedText: string,
  editedText: string,
) {
  if (!audioBlob.size) throw new Error("The downloaded audio file is empty.")

  await requestPersistentStorage()
  await assertStorageCapacity(audioBlob.size)

  const db = await openDb()
  const tx = db.transaction([FILES_STORE, TRANSCRIPTS_STORE, EDITED_TEXT_STORE], "readwrite")
  const done = transactionDone(tx)
  const savedAt = new Date().toISOString()

  const fileRecord: OfflineFileRecord = {
    id: file.id,
    jobId: job.id,
    batchId: file.batch_id,
    name: file.name,
    durationSeconds: file.duration_seconds,
    sizeBytes: file.size_bytes,
    mimeType: file.mime_type,
    description: file.description,
    tags: file.tags,
    savedAt,
    audioBlob,
  }

  const transcriptRecord: OfflineTranscriptRecord = {
    fileId: file.id,
    jobId: job.id,
    version: subtitle?.version ?? "cleaned",
    sourceName: subtitle?.source_name ?? file.name,
    cleanedText,
    cues: subtitle?.cues ?? [],
    savedAt,
  }

  const editedTextRecord: EditedTextRecord = {
    fileId: file.id,
    jobId: job.id,
    text: editedText || cleanedText,
    updatedAt: savedAt,
  }

  tx.objectStore(FILES_STORE).put(fileRecord)
  tx.objectStore(TRANSCRIPTS_STORE).put(transcriptRecord)
  tx.objectStore(EDITED_TEXT_STORE).put(editedTextRecord)
  await done

  // Read back the large Blob once so a failed/quota-truncated save never looks successful.
  const verified = await getOfflineFile(file.id)
  if (!verified || verified.audioBlob.size !== audioBlob.size) {
    throw new Error("Offline storage verification failed. The audio was not saved completely.")
  }

  emitLibraryChange()
  return { file: fileRecord, transcript: transcriptRecord, editedText: editedTextRecord }
}

export async function listOfflineFiles() {
  const db = await openDb()
  const tx = db.transaction(FILES_STORE, "readonly")
  const done = transactionDone(tx)
  const records = await requestResult(tx.objectStore(FILES_STORE).getAll() as IDBRequest<OfflineFileRecord[]>)
  await done
  return records.sort((a, b) => b.savedAt.localeCompare(a.savedAt))
}

export async function getOfflineFile(fileId: string) {
  const db = await openDb()
  const tx = db.transaction(FILES_STORE, "readonly")
  const done = transactionDone(tx)
  const record = await requestResult(tx.objectStore(FILES_STORE).get(fileId) as IDBRequest<OfflineFileRecord | undefined>)
  await done
  return record ?? null
}

export async function getOfflineFileByJobId(jobId: string) {
  const db = await openDb()
  const tx = db.transaction(FILES_STORE, "readonly")
  const done = transactionDone(tx)
  const record = await requestResult(tx.objectStore(FILES_STORE).index("jobId").get(jobId) as IDBRequest<OfflineFileRecord | undefined>)
  await done
  return record ?? null
}

export async function getOfflineTranscript(fileId: string) {
  const db = await openDb()
  const tx = db.transaction(TRANSCRIPTS_STORE, "readonly")
  const done = transactionDone(tx)
  const record = await requestResult(tx.objectStore(TRANSCRIPTS_STORE).get(fileId) as IDBRequest<OfflineTranscriptRecord | undefined>)
  await done
  return record ?? null
}

export async function getOfflineTranscriptByJobId(jobId: string) {
  const db = await openDb()
  const tx = db.transaction(TRANSCRIPTS_STORE, "readonly")
  const done = transactionDone(tx)
  const record = await requestResult(tx.objectStore(TRANSCRIPTS_STORE).index("jobId").get(jobId) as IDBRequest<OfflineTranscriptRecord | undefined>)
  await done
  return record ?? null
}

export async function getEditedTextSnapshot(fileId: string) {
  const db = await openDb()
  const tx = db.transaction(EDITED_TEXT_STORE, "readonly")
  const done = transactionDone(tx)
  const record = await requestResult(tx.objectStore(EDITED_TEXT_STORE).get(fileId) as IDBRequest<EditedTextRecord | undefined>)
  await done
  return record ?? null
}

async function editsFromIndex(indexName: "fileId" | "jobId", value: string) {
  const db = await openDb()
  const tx = db.transaction(EDITS_STORE, "readonly")
  const done = transactionDone(tx)
  const rows = await requestResult(tx.objectStore(EDITS_STORE).index(indexName).getAll(value) as IDBRequest<CueEditRecord[]>)
  await done
  return Object.fromEntries(rows.map((row) => [row.cueId, row.text]))
}

export function getCueEditsForFile(fileId: string) {
  return editsFromIndex("fileId", fileId)
}

export function getCueEditsForJob(jobId: string) {
  return editsFromIndex("jobId", jobId)
}

async function refreshEditedTextSnapshot(fileId: string, jobId: string) {
  const [transcript, edits] = await Promise.all([
    getOfflineTranscript(fileId),
    getCueEditsForFile(fileId),
  ])

  // If this file has not been saved offline yet, local cue edits still survive in cueEdits.
  if (!transcript) return

  const text = transcript.cues.length
    ? cuesToPlainText(transcript.cues, edits)
    : transcript.cleanedText

  const db = await openDb()
  const tx = db.transaction(EDITED_TEXT_STORE, "readwrite")
  const done = transactionDone(tx)
  const row: EditedTextRecord = {
    fileId,
    jobId,
    text,
    updatedAt: new Date().toISOString(),
  }
  tx.objectStore(EDITED_TEXT_STORE).put(row)
  await done
}

export async function saveCueEdit(
  fileId: string,
  jobId: string,
  cueId: string,
  text: string,
  originalText: string,
) {
  const db = await openDb()
  const tx = db.transaction(EDITS_STORE, "readwrite")
  const done = transactionDone(tx)
  const store = tx.objectStore(EDITS_STORE)
  const key = `${fileId}:${cueId}`

  if (text === originalText) {
    store.delete(key)
  } else {
    const row: CueEditRecord = {
      key,
      fileId,
      jobId,
      cueId,
      text,
      updatedAt: new Date().toISOString(),
    }
    store.put(row)
  }

  await done
  await refreshEditedTextSnapshot(fileId, jobId)
}

export async function removeOfflineBundle(fileId: string) {
  const db = await openDb()
  const tx = db.transaction([FILES_STORE, TRANSCRIPTS_STORE, EDITED_TEXT_STORE], "readwrite")
  const done = transactionDone(tx)
  tx.objectStore(FILES_STORE).delete(fileId)
  tx.objectStore(TRANSCRIPTS_STORE).delete(fileId)
  tx.objectStore(EDITED_TEXT_STORE).delete(fileId)
  await done

  // Keep cue edits. Removing the downloaded audio should not erase corrections.
  emitLibraryChange()
}

export async function getOfflineBundle(fileId: string): Promise<OfflineBundle | null> {
  const file = await getOfflineFile(fileId)
  if (!file) return null

  const [transcript, edits, editedTextRecord] = await Promise.all([
    getOfflineTranscript(fileId),
    getCueEditsForFile(fileId),
    getEditedTextSnapshot(fileId),
  ])

  const editedText = editedTextRecord?.text
    ?? (transcript?.cues.length ? cuesToPlainText(transcript.cues, edits) : transcript?.cleanedText ?? "")

  return { file, transcript, edits, editedText }
}

export async function getOfflineBundleByJobId(jobId: string): Promise<OfflineBundle | null> {
  const file = await getOfflineFileByJobId(jobId)
  if (!file) return null
  return getOfflineBundle(file.id)
}
