import * as React from "react"

import { listOfflineFiles, OFFLINE_LIBRARY_EVENT, type OfflineFileRecord } from "@/lib/offline-db"

export function useOfflineLibrary() {
  const [files, setFiles] = React.useState<OfflineFileRecord[]>([])
  const [loading, setLoading] = React.useState(true)

  const refresh = React.useCallback(async () => {
    try {
      setFiles(await listOfflineFiles())
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void refresh()
    const onChange = () => void refresh()
    window.addEventListener(OFFLINE_LIBRARY_EVENT, onChange)
    return () => window.removeEventListener(OFFLINE_LIBRARY_EVENT, onChange)
  }, [refresh])

  return { files, loading, refresh }
}
