import { useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhoneInput } from "@/components/PhoneInput";
import { useAuth, type LoginResponse } from "@/lib/auth";
import { useAppSettings } from "@/lib/appSettings";

type Tab = "password" | "mobile" | "email";
type Channel = "sms" | "whatsapp" | "email";

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

export default function LoginPage() {
  const settings = useAppSettings();
  const { acceptAuthPayload, loginWith2faCheck } = useAuth();
  const [, navigate] = useLocation();

  const tabs: Array<{ id: Tab; label: string; enabled: boolean }> = [
    { id: "password", label: "Password", enabled: settings.authPasswordLoginEnabled !== false },
    { id: "mobile", label: "Mobile OTP", enabled: settings.authMobileOtpLoginEnabled !== false },
    { id: "email", label: "Email OTP", enabled: settings.authEmailOtpLoginEnabled !== false },
  ].filter(t => t.enabled);
  const [tab, setTab] = useState<Tab>(tabs[0]?.id ?? "password");

  // shared state for 2FA challenge step
  const [twoFa, setTwoFa] = useState<{ userId: number; channel: Channel; hint?: string } | null>(null);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <img src={settings.logoUrl || "/logo.png"} alt={settings.appName ?? "KhanaLagao"} className="mx-auto h-14 w-14 object-contain" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">Welcome back</h1>
            <p className="text-sm text-muted-foreground mt-1">Sign in to your {settings.appName ?? "KhanaLagao"} account</p>
          </div>
        </div>

        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-5">
          {twoFa ? (
            <TwoFactorStep
              userId={twoFa.userId}
              channel={twoFa.channel}
              hint={twoFa.hint}
              onCancel={() => setTwoFa(null)}
              onSuccess={(data) => {
                acceptAuthPayload(data);
                navigate("/dashboard");
              }}
            />
          ) : (
            <>
              {tabs.length > 1 && (
                <div className="grid grid-cols-3 bg-muted rounded-lg p-1 text-sm" role="tablist">
                  {tabs.map(t => (
                    <button
                      key={t.id}
                      role="tab"
                      aria-selected={tab === t.id}
                      onClick={() => setTab(t.id)}
                      className={`py-1.5 rounded-md transition-colors ${tab === t.id ? "bg-card shadow-sm text-foreground font-medium" : "text-muted-foreground"}`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              )}

              {tab === "password" && (
                <PasswordTab
                  on2fa={(c) => setTwoFa(c)}
                  onSuccess={() => navigate("/dashboard")}
                  loginWith2faCheck={loginWith2faCheck}
                />
              )}
              {tab === "mobile" && (
                <OtpTab
                  channelKind="mobile"
                  defaultChannel={settings.authOtpDefaultChannel === "whatsapp" ? "whatsapp" : "sms"}
                  on2fa={(c) => setTwoFa(c)}
                  onSuccess={(data) => { acceptAuthPayload(data); navigate("/dashboard"); }}
                />
              )}
              {tab === "email" && (
                <OtpTab
                  channelKind="email"
                  defaultChannel="email"
                  on2fa={(c) => setTwoFa(c)}
                  onSuccess={(data) => { acceptAuthPayload(data); navigate("/dashboard"); }}
                />
              )}
            </>
          )}

          {settings.signupEnabled && (
            <div className="text-center text-sm text-muted-foreground">
              Don&apos;t have an account?{" "}
              <a href="/app/register" className="text-primary font-medium hover:underline">
                Start free trial
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
function PasswordTab({
  on2fa,
  onSuccess,
  loginWith2faCheck,
}: {
  on2fa: (c: { userId: number; channel: Channel; hint?: string }) => void;
  onSuccess: () => void;
  loginWith2faCheck: (email: string, password: string) => Promise<LoginResponse>;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  async function handle(e: FormEvent) {
    e.preventDefault();
    setErr(""); setLoading(true);
    try {
      const r = await loginWith2faCheck(email.trim(), password);
      if (r.requires2fa && r.userId && r.twoFactorChannel) {
        on2fa({ userId: r.userId, channel: r.twoFactorChannel, hint: r.identifierHint });
      } else {
        onSuccess();
      }
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Login failed");
    } finally { setLoading(false); }
  }

  return (
    <form onSubmit={handle} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" placeholder="you@restaurant.com" />
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Password</Label>
          <a href="/forgot-password" className="text-xs text-primary hover:underline">Forgot password?</a>
        </div>
        <div className="relative">
          <Input id="password" type={show ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" className="pr-10" placeholder="••••••••" />
          <button type="button" onClick={() => setShow(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
            {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      </div>
      {err && <ErrorBox msg={err} />}
      <Button type="submit" className="w-full" disabled={loading}>{loading ? "Signing in…" : "Sign in"}</Button>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────
function OtpTab({
  channelKind, defaultChannel, on2fa, onSuccess,
}: {
  channelKind: "mobile" | "email";
  defaultChannel: Channel;
  on2fa: (c: { userId: number; channel: Channel; hint?: string }) => void;
  onSuccess: (data: { accessToken: string; refreshToken: string; user: NonNullable<LoginResponse["user"]> }) => void;
}) {
  const [identifier, setIdentifier] = useState("");
  const [channel, setChannel] = useState<Channel>(defaultChannel);
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"request" | "verify">("request");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);

  async function send(e: FormEvent) {
    e.preventDefault();
    setErr(""); setLoading(true);
    try {
      const r = await postJSON<{ ok: boolean; devCode?: string }>("/auth/request-otp", { channel, identifier });
      setDevCode(r.devCode ?? null);
      setStep("verify");
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Could not send code");
    } finally { setLoading(false); }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setErr(""); setLoading(true);
    try {
      const r = await postJSON<{
        ok: boolean; requires2fa?: boolean; twoFactorChannel?: Channel; userId?: number; identifierHint?: string;
        accessToken?: string; refreshToken?: string; user?: NonNullable<LoginResponse["user"]>;
      }>("/auth/verify-otp", { channel, identifier, code });
      if (r.requires2fa && r.userId && r.twoFactorChannel) {
        on2fa({ userId: r.userId, channel: r.twoFactorChannel, hint: r.identifierHint });
      } else if (r.accessToken && r.refreshToken && r.user) {
        onSuccess({ accessToken: r.accessToken, refreshToken: r.refreshToken, user: r.user });
      } else {
        setErr("Login failed. Try again.");
      }
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Invalid code");
    } finally { setLoading(false); }
  }

  if (step === "verify") {
    return (
      <form onSubmit={verify} className="space-y-4">
        <div className="text-sm text-muted-foreground">
          We sent a 6-digit code to <span className="font-medium text-foreground">{identifier}</span>.
          <button type="button" className="ml-2 text-primary underline" onClick={() => { setStep("request"); setCode(""); }}>
            Change
          </button>
        </div>
        {devCode && <div className="text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded px-2 py-1">Dev code: <b>{devCode}</b></div>}
        <div className="space-y-1.5">
          <Label htmlFor="code">Verification code</Label>
          <Input id="code" inputMode="numeric" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))} required placeholder="123456" autoComplete="one-time-code" />
        </div>
        {err && <ErrorBox msg={err} />}
        <Button type="submit" className="w-full" disabled={loading || code.length !== 6}>{loading ? "Verifying…" : "Verify & sign in"}</Button>
      </form>
    );
  }

  return (
    <form onSubmit={send} className="space-y-4">
      {channelKind === "mobile" ? (
        <>
          <div className="space-y-1.5">
            <Label>Mobile number</Label>
            <PhoneInput value={identifier} onChange={setIdentifier} defaultCountry="IN" placeholder="9876543210" />
          </div>
          <div className="space-y-1.5">
            <Label>Send code via</Label>
            <div className="grid grid-cols-2 gap-2">
              {(["sms", "whatsapp"] as const).map(c => (
                <button type="button" key={c}
                  onClick={() => setChannel(c)}
                  className={`py-2 text-sm border rounded-lg ${channel === c ? "border-primary bg-primary/5 text-primary font-medium" : "border-border text-muted-foreground"}`}>
                  {c === "sms" ? "SMS" : "WhatsApp"}
                </button>
              ))}
            </div>
          </div>
        </>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor="otp-email">Email</Label>
          <Input id="otp-email" type="email" value={identifier} onChange={e => setIdentifier(e.target.value)} required placeholder="you@restaurant.com" autoComplete="email" />
        </div>
      )}
      {err && <ErrorBox msg={err} />}
      <Button type="submit" className="w-full" disabled={loading || !identifier}>{loading ? "Sending…" : "Send code"}</Button>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────
function TwoFactorStep({
  userId, channel, hint, onCancel, onSuccess,
}: {
  userId: number;
  channel: Channel;
  hint?: string;
  onCancel: () => void;
  onSuccess: (data: { accessToken: string; refreshToken: string; user: NonNullable<LoginResponse["user"]> }) => void;
}) {
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  async function verify(e: FormEvent) {
    e.preventDefault();
    setErr(""); setLoading(true);
    try {
      const r = await postJSON<{ accessToken: string; refreshToken: string; user: NonNullable<LoginResponse["user"]> }>("/auth/2fa/verify", { userId, code });
      onSuccess(r);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Invalid code");
    } finally { setLoading(false); }
  }

  return (
    <form onSubmit={verify} className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Two-factor authentication</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Enter the 6-digit code we sent via {channel === "email" ? "email" : channel === "whatsapp" ? "WhatsApp" : "SMS"}
          {hint ? ` to ${hint}` : ""}.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="tfa-code">Code</Label>
        <Input id="tfa-code" inputMode="numeric" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))} required placeholder="123456" autoComplete="one-time-code" autoFocus />
      </div>
      {err && <ErrorBox msg={err} />}
      <div className="flex gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>Back</Button>
        <Button type="submit" className="flex-1" disabled={loading || code.length !== 6}>{loading ? "Verifying…" : "Verify"}</Button>
      </div>
    </form>
  );
}

function ErrorBox({ msg }: { msg: string }) {
  return (
    <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
      {msg}
    </div>
  );
}
