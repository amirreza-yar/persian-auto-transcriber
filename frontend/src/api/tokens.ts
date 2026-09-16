import { api } from "@/api/client"
import type { ApiToken } from "@/types/api"

export interface CreateTokenInput {
  label: string
  token: string
  priority?: number
  daily_token_limit?: number | null
  daily_request_limit?: number | null
}

export interface UpdateTokenInput {
  label?: string
  enabled?: boolean
  priority?: number
  daily_token_limit?: number
  daily_request_limit?: number
  clear_daily_token_limit?: boolean
  clear_daily_request_limit?: boolean
}

export async function listTokens() {
  const { data } = await api.get<ApiToken[]>("/tokens")
  return data
}

export async function createToken(input: CreateTokenInput) {
  const { data } = await api.post<ApiToken>("/tokens", { provider: "gemini", ...input })
  return data
}

export async function updateToken(tokenId: string, input: UpdateTokenInput) {
  const { data } = await api.patch<ApiToken>(`/tokens/${tokenId}`, input)
  return data
}

export async function deleteToken(tokenId: string) {
  const { data } = await api.delete<{ deleted: string }>(`/tokens/${tokenId}`)
  return data
}
