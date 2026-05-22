import { useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhoneInput } from "@/components/PhoneInput";
import { parsePhone } from "@workspace/phone-utils";
import { useAuth, type AuthUser } from "@/lib/auth";
import { useAppSettings } from "@/lib/appSettings";
import { GoogleSignInButton, OrDivider } from "@/components/GoogleSignInButton";

const FEATURES = [
  "14-day free trial — no credit card required",
  "POS, kitchen display, QR ordering included",
  "Multi-branch & staff management",
  "Inventory and customer loyalty built-in",
];

type Step = "choose" | "phone" | "otp" | "details" | "email";

async function postJSON<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error((err as { error?: string }).error ?? "Request failed");
  }
  return res.json() as Promise<T>;
}

export default function RegisterPage() {
  const settings = useAppSettings();
  const { acceptAuthPayload } = useAuth();
  const [, navigate] = useLocation();

  const needsOtp = settings.authSelfRegistrationRequireMobileOtp !== false;
  const [step, setStep] = useState<Step>("choose");
  const [phone, setPhone] = useState("");
  const [channel, setChannel] = useState<"sms" | "whatsapp">(settings.authOtpDefaultChannel === "whatsapp" ? "whatsapp" : "sms");
  const [code, setCode] = useState("");
  const [token, setToken] = useState<string | null>(null);

  const [details, setDetails] = useState({ restaurantName: "", ownerName: "", email: "", password: "" });

  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  if (!settings.signupEnabled) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-background">
        <div className="max-w-md text-center space-y-3">
          <h1 className="text-2xl font-semibold">Signups are paused</h1>
          <p className="text-muted-foreground">
            New restaurant signups are currently disabled. Please contact{" "}
            <a className="text-primary underline" href={`mailto:${settings.supportEmail}`}>{settings.supportEmail}</a> to get access.
          </p>
          <a href="/app/login" className="inline-block text-sm text-primary underline">Back to sign in</a>
        </div>
      </div>
    );
  }

  async function startOtp(e: FormEvent) {
    e.preventDefault();
    setErr(""); setLoading(true);
    try {
      const trimmed = phone.trim();
      if (!trimmed) throw new Error("Enter your mobile number");
      const { country, national } = parsePhone(trimmed, "IN");
      const local = national.replace(/\D+/g, "");
      if (local.length < 6) throw new Error("Enter a valid mobile number");
      const countryCode = `+${country.code}`;
      const r = await postJSON<{ registrationToken: string }>("/auth/register/start", { countryCode, phone: local, channel });
      setToken(r.registrationToken);
      setStep("otp");
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : "Could not send code"); }
    finally { setLoading(false); }
  }

  async function verifyOtp(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setErr(""); setLoading(true);
    try {
      await postJSON("/auth/register/verify-otp", { registrationToken: token, code, channel });
      setStep("details");
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : "Invalid code"); }
    finally { setLoading(false); }
  }

  async function complete(e: FormEvent) {
    e.preventDefault();
    if (details.password.length < 8) { setErr("Password must be at least 8 characters"); return; }
    setErr(""); setLoading(true);
    try {
      const r = await postJSON<{ accessToken: string; refreshToken: string; user: AuthUser }>("/auth/register/complete", {
        registrationToken: token,
        restaurantName: details.restaurantName,
        ownerName: details.ownerName,
        email: details.email,
        password: details.password,
      });
      acceptAuthPayload(r);
      navigate("/welcome");
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : "Registration failed"); }
    finally { setLoading(false); }
  }

  // Email-first signup path — collects everything in one form and calls
  // the existing /auth/register endpoint (which already supports email-only
  // signup). Phone is optional here; users who pick this path are saying
  // "I'd rather use email", so we don't force them through phone OTP.
  async function completeEmail(e: FormEvent) {
    e.preventDefault();
    if (details.password.length < 8) { setErr("Password must be at least 8 characters"); return; }
    setErr(""); setLoading(true);
    try {
      const r = await postJSON<{ accessToken: string; refreshToken: string; user: AuthUser }>("/auth/register", {
        restaurantName: details.restaurantName,
        ownerName: details.ownerName,
        email: details.email,
        password: details.password,
      });
      acceptAuthPayload(r);
      navigate("/welcome");
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : "Registration failed"); }
    finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-4xl grid md:grid-cols-2 gap-10 items-center">
        <div className="space-y-6 hidden md:block">
          <div className="flex items-center gap-3">
            <img src={settings.logoUrl || "/logo.png"} alt={settings.appName ?? "KhanaLagao"} className="h-10 w-10 object-contain" />
            <span className="text-xl font-bold text-foreground">{settings.appName ?? "KhanaLagao"}</span>
          </div>
          <div className="space-y-2">
            <h1 className="text-3xl font-bold text-foreground leading-tight">The all-in-one platform for modern restaurants</h1>
            <p className="text-muted-foreground">Everything you need to run your restaurant — from table management to kitchen display to customer loyalty.</p>
          </div>
          <ul className="space-y-3">
            {FEATURES.map(f => (
              <li key={f} className="flex items-center gap-3">
                <div className="w-5 h-5 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
                  <Check className="w-3 h-3 text-primary" />
                </div>
                <span className="text-sm text-foreground">{f}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="bg-card border border-border rounded-2xl p-8 shadow-sm space-y-5">
          <div className="flex items-center gap-3 md:hidden">
            <img src={settings.logoUrl || "/logo.png"} alt={settings.appName ?? "KhanaLagao"} className="h-9 w-9 object-contain" />
            <span className="font-bold text-lg">{settings.appName ?? "KhanaLagao"}</span>
          </div>
          <div>
            <h2 className="text-xl font-semibold text-foreground">
              {step === "choose" && "How would you like to sign up?"}
              {step === "phone" && "Let's start with your phone"}
              {step === "otp" && "Verify your phone"}
              {step === "details" && "Almost there"}
              {step === "email" && "Create your account"}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              {step === "choose" && "Pick the option that's easiest for you. You can change it later."}
              {step === "phone" && "We'll send a one-time code to confirm your number."}
              {step === "otp" && `Enter the 6-digit code sent via ${channel === "whatsapp" ? "WhatsApp" : "SMS"}.`}
              {step === "details" && "Tell us about your restaurant to finish setting up your free trial."}
              {step === "email" && "Sign up with your work email — you can add your phone number later."}
            </p>
          </div>

          {step === "choose" && (
            <div className="space-y-3">
              <Button
                type="button"
                className="w-full"
                onClick={() => setStep("phone")}
              >
                Sign up with phone
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => setStep("email")}
              >
                Sign up with email
              </Button>
              {settings.googleSignInEnabled && (
                <>
                  <OrDivider />
                  <GoogleSignInButton
                    label="Continue with Google"
                    mode="register"
                    onCompleteProfileNeeded={() => navigate("/complete-profile")}
                  />
                </>
              )}
            </div>
          )}

          {step === "phone" && (
            <form onSubmit={startOtp} className="space-y-4">
              <div className="space-y-1.5">
                <Label>Mobile number</Label>
                <PhoneInput value={phone} onChange={setPhone} defaultCountry="IN" placeholder="9876543210" />
              </div>
              <div className="space-y-1.5">
                <Label>Send code via</Label>
                <div className="grid grid-cols-2 gap-2">
                  {(["sms", "whatsapp"] as const).map(c => (
                    <button type="button" key={c} onClick={() => setChannel(c)}
                      className={`py-2 text-sm border rounded-lg ${channel === c ? "border-primary bg-primary/5 text-primary font-medium" : "border-border text-muted-foreground"}`}>
                      {c === "sms" ? "SMS" : "WhatsApp"}
                    </button>
                  ))}
                </div>
              </div>
              {err && <ErrorBox msg={err} />}
              <Button type="submit" className="w-full" disabled={loading || !phone}>{loading ? "Sending…" : "Send code"}</Button>
            </form>
          )}

          {step === "otp" && (
            <form onSubmit={verifyOtp} className="space-y-4">
              <div className="space-y-1.5">
                <Label>Verification code</Label>
                <Input inputMode="numeric" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))} required placeholder="123456" autoComplete="one-time-code" autoFocus />
              </div>
              {err && <ErrorBox msg={err} />}
              <div className="flex gap-2">
                <Button type="button" variant="ghost" onClick={() => { setStep("phone"); setCode(""); }}>Back</Button>
                <Button type="submit" className="flex-1" disabled={loading || code.length !== 6}>{loading ? "Verifying…" : "Verify"}</Button>
              </div>
            </form>
          )}

          {step === "email" && (
            <form onSubmit={completeEmail} className="space-y-4">
              <div className="space-y-1.5">
                <Label>Restaurant name</Label>
                <Input value={details.restaurantName} onChange={e => setDetails(d => ({ ...d, restaurantName: e.target.value }))} required placeholder="Spice Garden" />
              </div>
              <div className="space-y-1.5">
                <Label>Your name</Label>
                <Input value={details.ownerName} onChange={e => setDetails(d => ({ ...d, ownerName: e.target.value }))} required placeholder="Priya Sharma" />
              </div>
              <div className="space-y-1.5">
                <Label>Work email</Label>
                <Input type="email" value={details.email} onChange={e => setDetails(d => ({ ...d, email: e.target.value }))} required autoComplete="email" placeholder="priya@spicegarden.com" />
              </div>
              <div className="space-y-1.5">
                <Label>Password</Label>
                <Input type="password" value={details.password} onChange={e => setDetails(d => ({ ...d, password: e.target.value }))} required autoComplete="new-password" placeholder="At least 8 characters" />
              </div>
              {err && <ErrorBox msg={err} />}
              <div className="flex gap-2">
                <Button type="button" variant="ghost" onClick={() => setStep("choose")}>Back</Button>
                <Button type="submit" className="flex-1" disabled={loading}>{loading ? "Creating account…" : "Start free trial"}</Button>
              </div>
            </form>
          )}

          {step === "details" && (
            <form onSubmit={complete} className="space-y-4">
              <div className="space-y-1.5">
                <Label>Restaurant name</Label>
                <Input value={details.restaurantName} onChange={e => setDetails(d => ({ ...d, restaurantName: e.target.value }))} required placeholder="Spice Garden" />
              </div>
              <div className="space-y-1.5">
                <Label>Your name</Label>
                <Input value={details.ownerName} onChange={e => setDetails(d => ({ ...d, ownerName: e.target.value }))} required placeholder="Priya Sharma" />
              </div>
              <div className="space-y-1.5">
                <Label>Work email</Label>
                <Input type="email" value={details.email} onChange={e => setDetails(d => ({ ...d, email: e.target.value }))} required autoComplete="email" placeholder="priya@spicegarden.com" />
              </div>
              <div className="space-y-1.5">
                <Label>Password</Label>
                <Input type="password" value={details.password} onChange={e => setDetails(d => ({ ...d, password: e.target.value }))} required autoComplete="new-password" placeholder="At least 8 characters" />
              </div>
              {err && <ErrorBox msg={err} />}
              <Button type="submit" className="w-full" disabled={loading}>{loading ? "Creating account…" : "Start free trial"}</Button>
            </form>
          )}

          <p className="text-center text-sm text-muted-foreground">
            Already have an account? <a href="/app/login" className="text-primary font-medium hover:underline">Sign in</a>
          </p>
        </div>
      </div>
    </div>
  );
}

function ErrorBox({ msg }: { msg: string }) {
  return <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">{msg}</div>;
}
