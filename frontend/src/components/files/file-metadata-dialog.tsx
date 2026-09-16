import * as React from "react"
import { toast } from "sonner"
import { normalizeApiError } from "@/api/client"
import { updateAudioFile } from "@/api/files"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { AudioFile } from "@/types/api"

export function FileMetadataDialog({ file, open, onOpenChange, onUpdated }: { file: AudioFile; open: boolean; onOpenChange: (open: boolean) => void; onUpdated: (file: AudioFile) => void }) {
  const [description, setDescription] = React.useState(file.description ?? "")
  const [tags, setTags] = React.useState(file.tags.join(", "))
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setDescription(file.description ?? "")
    setTags(file.tags.join(", "))
  }, [file, open])

  const save = async () => {
    setBusy(true)
    try {
      const updated = await updateAudioFile(file.id, {
        description,
        tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
      })
      onUpdated(updated)
      onOpenChange(false)
      toast.success("File details saved.")
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
          <DialogTitle>File details</DialogTitle>
          <DialogDescription>Add a simple description or tags to make this recording easier to find.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="file-description">Description</Label>
            <Textarea id="file-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Meeting, lesson, interview…" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="file-tags">Tags</Label>
            <Input id="file-tags" value={tags} onChange={(event) => setTags(event.target.value)} placeholder="meeting, vadi 4" />
            <p className="text-muted-foreground text-xs">Separate tags with commas.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
