import * as React from "react"
import { toast } from "sonner"

import { normalizeApiError } from "@/api/client"
import { createToken } from "@/api/tokens"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { ApiToken } from "@/types/api"

export function TokenDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (token: ApiToken) => void }) {
  const [label, setLabel] = React.useState("")
  const [token, setToken] = React.useState("")
  const [priority, setPriority] = React.useState("0")
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setLabel("")
    setToken("")
    setPriority("0")
  }, [open])

  const submit = async () => {
    if (!label.trim() || token.trim().length < 8) {
      toast.error("Enter a label and a valid Gemini API token.")
      return
    }
    setBusy(true)
    try {
      const created = await createToken({ label: label.trim(), token: token.trim(), priority: Number(priority) || 0 })
      onCreated(created)
      onOpenChange(false)
      toast.success("Gemini token added.")
    } catch (error) {
      toast.error(normalizeApiError(error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Gemini token</DialogTitle>
          <DialogDescription>The token is sent to the local backend and stored there encrypted. It is not kept in the browser.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="token-label">Label</Label>
            <Input id="token-label" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Primary" autoComplete="off" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="token-value">API token</Label>
            <Input id="token-value" type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="Paste token" autoComplete="off" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="token-priority">Priority</Label>
            <Input id="token-priority" type="number" value={priority} onChange={(event) => setPriority(event.target.value)} />
            <p className="text-muted-foreground text-xs">Higher priority tokens are tried first.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={busy}>{busy ? "Adding…" : "Add token"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
