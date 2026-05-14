import { useRef, useState } from "react";
import { apiPost } from "@/lib/api";
import { useSetting, useRestaurantId } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Upload, Link as LinkIcon, X, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";


interface MenuImageCfg {
  aspectRatio?: string;
  maxUploadKb?: number;
  autoCompress?: boolean;
  fallbackPlaceholder?: string;
  showInCustomerMenu?: boolean;
}

interface Props {
  value: string;
  onChange: (url: string) => void;
  label?: string;
  className?: string;
}

function aspectRatioToNumber(ar: string | undefined): number {
  if (!ar) return 1;
  const [w, h] = ar.split(":").map(Number);
  if (!w || !h) return 1;
  return w / h;
}

async function compressImage(file: File, maxKb: number, aspectRatio: number): Promise<Blob> {
  const dataUrl: string = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
  const img: HTMLImageElement = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = dataUrl;
  });

  let targetW = img.width;
  let targetH = img.height;
  const currentAR = img.width / img.height;
  if (Math.abs(currentAR - aspectRatio) > 0.02) {
    if (currentAR > aspectRatio) {
      targetW = Math.round(img.height * aspectRatio);
      targetH = img.height;
    } else {
      targetW = img.width;
      targetH = Math.round(img.width / aspectRatio);
    }
  }
  const sx = Math.max(0, (img.width - targetW) / 2);
  const sy = Math.max(0, (img.height - targetH) / 2);

  const maxDim = 1600;
  const scale = Math.min(1, maxDim / Math.max(targetW, targetH));
  const outW = Math.round(targetW * scale);
  const outH = Math.round(targetH * scale);

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.drawImage(img, sx, sy, targetW, targetH, 0, 0, outW, outH);

  let quality = 0.9;
  let blob: Blob | null = null;
  for (let i = 0; i < 6; i++) {
    blob = await new Promise<Blob | null>(res => canvas.toBlob(res, "image/jpeg", quality));
    if (!blob) throw new Error("Failed to encode image");
    if (blob.size / 1024 <= maxKb) return blob;
    quality -= 0.15;
    if (quality < 0.3) break;
  }
  return blob ?? new Blob();
}

export function ImageUploadField({ value, onChange, label = "Image", className }: Props) {
  const RESTAURANT_ID = useRestaurantId();
  const { data: settingResp } = useSetting<MenuImageCfg>("menu-image");
  const cfg = settingResp?.data ?? {};
  const aspectRatio = cfg.aspectRatio ?? "1:1";
  const maxUploadKb = cfg.maxUploadKb ?? 1024;
  const autoCompress = cfg.autoCompress !== false;
  const arNum = aspectRatioToNumber(aspectRatio);

  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [showUrl, setShowUrl] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const { toast } = useToast();

  const handleFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast({ title: "Please choose an image file", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      let payload: Blob = file;
      let contentType = file.type;
      let name = file.name;
      if (autoCompress) {
        payload = await compressImage(file, maxUploadKb, arNum);
        contentType = "image/jpeg";
        name = name.replace(/\.[^.]+$/, "") + ".jpg";
      }
      if (payload.size / 1024 > maxUploadKb) {
        toast({ title: `Image too large (${Math.round(payload.size / 1024)} KB > ${maxUploadKb} KB)`, variant: "destructive" });
        setBusy(false);
        return;
      }
      const presign = await apiPost<{ uploadURL: string; objectPath: string }>(
        `/restaurants/${RESTAURANT_ID}/storage/uploads/request-url`,
        { name, size: payload.size, contentType },
      );
      const put = await fetch(presign.uploadURL, { method: "PUT", body: payload, headers: { "Content-Type": contentType } });
      if (!put.ok) throw new Error("Upload failed");
      await apiPost(`/restaurants/${RESTAURANT_ID}/storage/uploads/finalize-public`, { objectPath: presign.objectPath });
      onChange(presign.objectPath);
      toast({ title: "Image uploaded" });
    } catch (e: unknown) {
      const msg = (e as { message?: string })?.message ?? "Upload failed";
      toast({ title: msg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const previewSrc = resolveImageUrl(value);

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        <div className="flex items-center gap-1">
          <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => fileRef.current?.click()} disabled={busy}>
            {busy ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Upload className="w-3 h-3 mr-1" />}
            Upload
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setShowUrl(s => !s); setUrlInput(value); }}>
            <LinkIcon className="w-3 h-3 mr-1" /> URL
          </Button>
          {value && (
            <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onChange("")}>
              <X className="w-3 h-3" />
            </Button>
          )}
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) void handleFile(f); e.target.value = ""; }}
      />
      {showUrl && (
        <div className="flex items-center gap-2">
          <Input
            placeholder="https://example.com/image.jpg"
            value={urlInput}
            onChange={e => setUrlInput(e.target.value)}
            className="h-8 text-xs"
          />
          <Button type="button" size="sm" className="h-8" onClick={() => { onChange(urlInput.trim()); setShowUrl(false); }}>Use</Button>
        </div>
      )}
      <div
        onDragOver={e => { e.preventDefault(); e.stopPropagation(); if (!dragOver) setDragOver(true); }}
        onDragEnter={e => { e.preventDefault(); e.stopPropagation(); setDragOver(true); }}
        onDragLeave={e => { e.preventDefault(); e.stopPropagation(); setDragOver(false); }}
        onDrop={e => {
          e.preventDefault(); e.stopPropagation(); setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) void handleFile(f);
        }}
        onClick={() => { if (!previewSrc && !busy) fileRef.current?.click(); }}
        className={cn(
          "relative w-full overflow-hidden rounded-md border transition-colors",
          previewSrc ? "border-border bg-muted/30" : "border-dashed border-border bg-muted/20 cursor-pointer hover:bg-muted/30",
          dragOver && "border-primary bg-primary/5 ring-2 ring-primary/30",
        )}
        style={{ aspectRatio: arNum }}
      >
        {previewSrc ? (
          <img src={previewSrc} alt="preview" className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.opacity = "0.3"; }} />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-xs text-muted-foreground gap-1">
            <Upload className="w-4 h-4" />
            <span>{dragOver ? "Drop image to upload" : "Drag & drop or click to upload"}</span>
          </div>
        )}
        {dragOver && previewSrc && (
          <div className="absolute inset-0 bg-primary/20 flex items-center justify-center text-xs font-medium text-primary">
            Drop to replace
          </div>
        )}
      </div>
      <p className="text-[10px] text-muted-foreground">
        {aspectRatio} · max {maxUploadKb} KB{autoCompress ? " · auto-compress on" : ""}
      </p>
    </div>
  );
}

export function resolveImageUrl(url: string | null | undefined): string {
  if (!url) return "";
  if (url.startsWith("/objects/")) {
    const base = (import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "");
    return `${base}/api/public/storage${url}`;
  }
  return url;
}
