import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PortalLayout } from "@/components/portal/PortalLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { apiFetch, apiPost } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Folder, Upload, FileText, Loader2 } from "lucide-react";

interface Doc { id: number; label: string; fileUrl: string; mimeType: string | null; sizeBytes: number | null; createdAt: string }

export default function PortalDocumentsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: docs = [] } = useQuery<Doc[]>({ queryKey: ["portal-documents"], queryFn: () => apiFetch("/portal/documents") });
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function uploadFlow() {
    if (!file || !label.trim()) return;
    setBusy(true);
    try {
      const req = await apiPost<{ uploadURL: string; objectPath: string }>("/storage/uploads/request-url", {});
      await fetch(req.uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      const fin = await apiPost<{ objectPath: string }>("/storage/uploads/finalize", { objectPath: req.objectPath, isPublic: false });
      await apiPost("/portal/documents", { label: label.trim(), fileUrl: fin.objectPath, mimeType: file.type, sizeBytes: file.size });
      qc.invalidateQueries({ queryKey: ["portal-documents"] });
      setOpen(false); setLabel(""); setFile(null);
      toast({ title: "Document uploaded" });
    } catch (e) {
      toast({ title: "Upload failed", description: e instanceof Error ? e.message : "Unknown", variant: "destructive" });
    } finally { setBusy(false); }
  }

  return (
    <PortalLayout>
      <div className="p-4 md:p-6 space-y-4 max-w-3xl mx-auto">
        <div className="flex items-center justify-between">
          <h1 className="text-xl md:text-2xl font-semibold flex items-center gap-2"><Folder className="w-6 h-6" />Documents</h1>
          <Button size="sm" onClick={() => setOpen(true)} data-testid="btn-upload-doc"><Upload className="w-4 h-4 mr-1" />Upload</Button>
        </div>
        {docs.length === 0 ? <p className="text-sm text-muted-foreground">No documents yet.</p> : (
          <div className="space-y-2">
            {docs.map(d => (
              <Card key={d.id}><CardContent className="p-3 flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{d.label}</p>
                    <p className="text-xs text-muted-foreground">{new Date(d.createdAt).toLocaleDateString()}</p>
                  </div>
                </div>
                <a href={`/api/storage/objects${d.fileUrl.replace(/^\/objects/, "")}`} target="_blank" rel="noreferrer">
                  <Button size="sm" variant="outline">Open</Button>
                </a>
              </CardContent></Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Upload document</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Label</Label><Input value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Aadhaar card" /></div>
            <div><Label>File</Label><Input type="file" onChange={e => setFile(e.target.files?.[0] ?? null)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={uploadFlow} disabled={!file || !label.trim() || busy} data-testid="btn-upload-confirm">
              {busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Upload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PortalLayout>
  );
}
