import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhoneInput } from "@/components/PhoneInput";
import { useAuth, type AuthUser } from "@/lib/auth";
import { useAppSettings } from "@/lib/appSettings";

// This page is reached after /auth/google/verify returns `pending: true`.
// We hold a short-lived `pendingToken` (passed via session storage by
// GoogleSignInButton) and use it to send + verify a phone OTP. Until the OTP
// is verified, the user has NO access token and no part of the app is
// reachable. There is no "skip" path — phone verification is mandatory when
// Super Admin has `googleRequirePhoneAfterSignup` enabled.
export default function CompleteProfilePage() {
  const { acceptAuthPayload } = useAuth();
  const [, navigate] = useLocation();
  const appSettings = useAppSettings();
  const whatsappEnabled = appSettings.whatsappEnabled !== false;

  const pendingToken = useMemo(() => sessionStorage.getItem("googlePendingToken"), []);
  const missingRestaurant = sessionStorage.getItem("googleMissingRestaurant") === "1";

  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [channel, setChannel] = useState<"sms" | "whatsapp">("sms");
  const [code, setCode] = useState("");
  const [restaurantName, setRestaurantName] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!pendingToken) navigate("/login");
  }, [pendingToken, navigate]);

  async function requestOtp(e: FormEvent) {
    e.preventDefault();
    if (!pendingToken) return;
    setErr(""); setLoading(true);
    try {
      const res = await fetch("/api/auth/google/pending/request-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pendingToken, phone, channel }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Could not send code");
      setStep("code");
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : "Could not send code"); }
    finally { setLoading(false); }
  }

  async function verifyOtp(e: FormEvent) {
    e.preventDefault();
    if (!pendingToken) return;
    setErr(""); setLoading(true);
    try {
      const res = await fetch("/api/auth/google/pending/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pendingToken, phone, code, channel, restaurantName: restaurantName || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Invalid code");
      const payload = data as { accessToken: string; refreshToken: string; user: AuthUser };
      acceptAuthPayload(payload);
      sessionStorage.removeItem("googlePendingToken");
      sessionStorage.removeItem("googleMissingRestaurant");
      navigate("/dashboard");
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : "Invalid code"); }
    finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="w-full max-w-md bg-card border border-border rounded-2xl p-6 shadow-sm space-y-5">
        <div>
          <h1 className="text-xl font-semibold">Verify your phone to finish signing up</h1>
          <p className="text-sm text-muted-foreground mt-1">
            We need to confirm your mobile number before your account becomes active.
          </p>
        </div>

        {step === "phone" && (
          <form onSubmit={requestOtp} className="space-y-4">
            {missingRestaurant && (
              <div className="space-y-1.5">
                <Label>Restaurant name</Label>
                <Input value={restaurantName} onChange={(e) => setRestaurantName(e.target.value)} required placeholder="Spice Garden" />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Mobile number</Label>
              <PhoneInput value={phone} onChange={setPhone} defaultCountry="IN" placeholder="9876543210" />
            </div>
            {whatsappEnabled && (
              <div className="space-y-1.5">
                <Label>Send code via</Label>
                <div className="grid grid-cols-2 gap-2">
                  {(["sms", "whatsapp"] as const).map((c) => (
                    <button type="button" key={c} onClick={() => setChannel(c)}
                      className={`py-2 text-sm border rounded-lg ${channel === c ? "border-primary bg-primary/5 text-primary font-medium" : "border-border text-muted-foreground"}`}>
                      {c === "sms" ? "SMS" : "WhatsApp"}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {err && <ErrorBox msg={err} />}
            <Button type="submit" className="w-full" disabled={loading || !phone || (missingRestaurant && !restaurantName.trim())}>
              {loading ? "Sending…" : "Send code"}
            </Button>
          </form>
        )}

        {step === "code" && (
          <form onSubmit={verifyOtp} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Verification code</Label>
              <Input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} required placeholder="123456" autoComplete="one-time-code" autoFocus />
            </div>
            {err && <ErrorBox msg={err} />}
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => { setStep("phone"); setCode(""); }}>Back</Button>
              <Button type="submit" className="flex-1" disabled={loading || code.length !== 6}>{loading ? "Verifying…" : "Verify & continue"}</Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function ErrorBox({ msg }: { msg: string }) {
  return <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">{msg}</div>;
}
