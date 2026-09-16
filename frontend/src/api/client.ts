import axios, { AxiosError } from "axios"

export interface NormalizedApiError {
  status: number | null
  message: string
  details?: unknown
}

export const api = axios.create({
  baseURL: "/api",
  timeout: 30_000,
  headers: { Accept: "application/json" },
})

export function normalizeApiError(error: unknown): NormalizedApiError {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<{ detail?: unknown }>
    const detail = axiosError.response?.data?.detail
    const message =
      typeof detail === "string"
        ? detail
        : axiosError.message || "The server request failed."

    return {
      status: axiosError.response?.status ?? null,
      message,
      details: detail,
    }
  }

  if (error instanceof Error) {
    return { status: null, message: error.message }
  }

  return { status: null, message: "Something went wrong." }
}
