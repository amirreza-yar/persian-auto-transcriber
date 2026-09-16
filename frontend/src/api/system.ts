import { api } from "@/api/client"
import type { CircuitBreaker, ModelStatus, SystemStatus, WorkerState } from "@/types/api"

export async function getSystemStatus() {
  const { data } = await api.get<SystemStatus>("/system/status")
  return data
}

export async function getModelStatus() {
  const { data } = await api.get<ModelStatus>("/system/model")
  return data
}

export async function getWorkers() {
  const { data } = await api.get<WorkerState[]>("/system/workers")
  return data
}

export async function getCircuits() {
  const { data } = await api.get<CircuitBreaker[]>("/system/circuits")
  return data
}

export async function resetCircuit(name: string) {
  const { data } = await api.post<{ name: string; state: string }>(`/system/circuits/${encodeURIComponent(name)}/reset`)
  return data
}
