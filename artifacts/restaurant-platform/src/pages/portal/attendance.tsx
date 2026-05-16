import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PortalLayout } from "@/components/portal/PortalLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiFetch, apiPost } from "@/lib/api";
import { Clock, MapPin, Camera, Loader2, Upload } from "lucide-react";

interface ActiveAttendance { id: number; clockIn: string; clockOut: string | null; status: string; workedMinutes: number | null; lateMinutes: number | null }
interface AttendanceRecord { id: number; clockIn: string; clockOut: string | null; status: string; workedMinutes: number | null; totalHours: string | null; lateMinutes: number | null; overtimeMinutes: number | null }

interface GeoState { lat: number | null; lng: number | null; accuracy: number | null; error: string | null }

function fmtMins(m: number | null) {
  if (!m) return "0h";
  const h = Math.floor(m / 60); const min = m % 60;
  return `${h}h ${min}m`;
}

export default function PortalAttendancePage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: active } = useQuery<ActiveAttendance | null>({
    queryKey: ["portal-active"], queryFn: () => apiFetch("/portal/attendance/active"),
    refetchInterval: 30_000,
  });
  const { data: history = [] } = useQuery<AttendanceRecord[]>({
    queryKey: ["portal-attendance-history"], queryFn: () => apiFetch("/portal/attendance?limit=30"),
  });

  const [geo, setGeo] = useState<GeoState>({ lat: null, lng: null, accuracy: null, error: null });
  const [selfie, setSelfie] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [streaming, setStreaming] = useState(false);

  useEffect(() => {
    if (!navigator.geolocation) { setGeo({ lat: null, lng: null, accuracy: null, error: "Geolocation not supported" }); return; }
    navigator.geolocation.getCurrentPosition(
      pos => setGeo({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, error: null }),
      err => setGeo({ lat: null, lng: null, accuracy: null, error: err.message }),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }, []);

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setStreaming(true);
      }
    } catch (e) {
      toast({ title: "Camera unavailable", description: e instanceof Error ? e.message : "Permission denied", variant: "destructive" });
    }
  }

  function captureSelfie() {
    const v = videoRef.current; if (!v) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth || 320; canvas.height = v.videoHeight || 240;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    setSelfie(canvas.toDataURL("image/jpeg", 0.8));
    const stream = v.srcObject as MediaStream | null;
    stream?.getTracks().forEach(t => t.stop());
    setStreaming(false);
  }

  async function uploadSelfie(): Promise<string | null> {
    if (!selfie) return null;
    try {
      const reqRes = await apiPost<{ uploadURL: string; objectPath: string }>("/storage/uploads/request-url", {});
      // dataURL → blob
      const blob = await (await fetch(selfie)).blob();
      await fetch(reqRes.uploadURL, { method: "PUT", body: blob, headers: { "Content-Type": "image/jpeg" } });
      const fin = await apiPost<{ objectPath: string }>("/storage/uploads/finalize", { objectPath: reqRes.objectPath, isPublic: false });
      return fin.objectPath;
    } catch {
      return null;
    }
  }

  const clockIn = useMutation({
    mutationFn: async () => {
      const selfieUrl = await uploadSelfie();
      return apiPost("/portal/attendance/clock-in", {
        latitude: geo.lat, longitude: geo.lng, accuracyMeters: geo.accuracy, selfieUrl,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-active"] });
      qc.invalidateQueries({ queryKey: ["portal-attendance-history"] });
      setSelfie(null);
      toast({ title: "Clocked in" });
    },
    onError: (e: Error) => toast({ title: "Clock-in failed", description: e.message, variant: "destructive" }),
  });

  const clockOut = useMutation({
    mutationFn: async () => {
      const selfieUrl = await uploadSelfie();
      return apiPost("/portal/attendance/clock-out", {
        latitude: geo.lat, longitude: geo.lng, accuracyMeters: geo.accuracy, selfieUrl,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-active"] });
      qc.invalidateQueries({ queryKey: ["portal-attendance-history"] });
      setSelfie(null);
      toast({ title: "Clocked out" });
    },
    onError: (e: Error) => toast({ title: "Clock-out failed", description: e.message, variant: "destructive" }),
  });

  return (
    <PortalLayout>
      <div className="p-4 md:p-6 space-y-5 max-w-3xl mx-auto">
        <h1 className="text-xl md:text-2xl font-semibold flex items-center gap-2"><Clock className="w-6 h-6" />Attendance</h1>

        <Card>
          <CardContent className="p-4 space-y-4">
            <div>
              <p className="text-sm text-muted-foreground">Status</p>
              {active ? (
                <div>
                  <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Clocked in</Badge>
                  <p className="text-xs text-muted-foreground mt-1">Since {new Date(active.clockIn).toLocaleTimeString()}</p>
                </div>
              ) : <Badge variant="outline">Not clocked in</Badge>}
            </div>

            <div className="text-xs text-muted-foreground flex items-center gap-2">
              <MapPin className="w-3.5 h-3.5" />
              {geo.error ? `Location: ${geo.error}` : geo.lat ? `Location: ${geo.lat.toFixed(5)}, ${geo.lng?.toFixed(5)} (~${Math.round(geo.accuracy ?? 0)}m)` : "Detecting location…"}
            </div>

            {/* Selfie */}
            <div className="space-y-2">
              <p className="text-xs font-medium">Selfie (optional but recommended)</p>
              {selfie ? (
                <div className="flex items-center gap-3">
                  <img src={selfie} alt="selfie" className="w-24 h-24 rounded-lg object-cover border" />
                  <Button variant="outline" size="sm" onClick={() => setSelfie(null)}>Retake</Button>
                </div>
              ) : streaming ? (
                <div className="space-y-2">
                  <video ref={videoRef} className="w-full max-w-xs rounded-lg border" muted playsInline />
                  <Button size="sm" onClick={captureSelfie}><Camera className="w-4 h-4 mr-1" />Capture</Button>
                </div>
              ) : (
                <Button variant="outline" size="sm" onClick={startCamera} data-testid="btn-start-camera"><Camera className="w-4 h-4 mr-1" />Open camera</Button>
              )}
            </div>

            <div className="flex gap-2 pt-2">
              {!active ? (
                <Button onClick={() => clockIn.mutate()} disabled={clockIn.isPending} data-testid="btn-clock-in" className="flex-1">
                  {clockIn.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Clock className="w-4 h-4 mr-1" />}Clock In
                </Button>
              ) : (
                <Button onClick={() => clockOut.mutate()} disabled={clockOut.isPending} variant="destructive" data-testid="btn-clock-out" className="flex-1">
                  {clockOut.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Upload className="w-4 h-4 mr-1" />}Clock Out
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <section>
          <h2 className="font-semibold mb-2">Recent attendance</h2>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No records yet.</p>
          ) : (
            <div className="space-y-2">
              {history.map(r => (
                <Card key={r.id}>
                  <CardContent className="p-3 flex items-center justify-between text-sm">
                    <div>
                      <p className="font-medium">{new Date(r.clockIn).toLocaleDateString()} <Badge variant="outline" className="ml-1 text-[10px]">{r.status}</Badge></p>
                      <p className="text-xs text-muted-foreground">
                        In {new Date(r.clockIn).toLocaleTimeString()} {r.clockOut && `· Out ${new Date(r.clockOut).toLocaleTimeString()}`}
                      </p>
                    </div>
                    <div className="text-right text-xs">
                      <p>{fmtMins(r.workedMinutes)}</p>
                      {(r.lateMinutes ?? 0) > 0 && <p className="text-amber-600">Late {fmtMins(r.lateMinutes)}</p>}
                      {(r.overtimeMinutes ?? 0) > 0 && <p className="text-emerald-600">OT {fmtMins(r.overtimeMinutes)}</p>}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>
      </div>
    </PortalLayout>
  );
}
