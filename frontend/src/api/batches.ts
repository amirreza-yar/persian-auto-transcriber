import { api } from "@/api/client"
import type { Batch } from "@/types/api"

export async function listBatches(limit = 100) {
  const { data } = await api.get<Batch[]>("/batches", { params: { limit } })
  return data
}

export async function getBatch(batchId: string) {
  const { data } = await api.get<Batch>(`/batches/${batchId}`)
  return data
}

export async function pauseBatch(batchId: string) {
  const { data } = await api.post<Batch>(`/batches/${batchId}/pause`)
  return data
}

export async function resumeBatch(batchId: string) {
  const { data } = await api.post<Batch>(`/batches/${batchId}/resume`)
  return data
}

export async function cancelBatch(batchId: string) {
  const { data } = await api.post<Batch>(`/batches/${batchId}/cancel`)
  return data
}

export async function retryBatch(batchId: string) {
  const { data } = await api.post<Batch>(`/batches/${batchId}/retry`)
  return data
}
