import { useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { Flame, ArrowLeft, Mail, KeyRound, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useForceLightTheme } from "@/lib/useForceLightTheme";

// Single-screen OTP-based password reset (replaces the old email-link flow).
//   step 1 "email"    → user enters email, server emails a 6-digit code
//   step 2 "verify"   → user enters the code + a new password on the SAME
//                       screen and we call /auth/reset-password
//   step 3 "done"     → confirmation + redirect to /login
// All three steps live on this one route so there's no separate
// reset-password page to land on from a link.
const API_BASE = "/api";

type Step = "email" | "verify" | "done";

export default function ForgotPasswordPage() {
  useForceLightTheme();
  const [, navigate] = useLocation();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [ttl, setTtl] = useState(15);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);

  async function requestCode(e?: FormEvent) {
    e?.preventDefault();
    setError("");
    setInfo("");
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as { ttlMinutes?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Couldn't send code. Please try again.");
      if (typeof data.ttlMinutes === "number") setTtl(data.ttlMinutes);
      setStep("verify");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send code. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function submitReset(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!/^\d{6}$/.test(code.trim())) { setError("Enter the 6-digit code from your email."); return; }
    if (password.length < 8)          { setError("Password must be at least 8 characters."); return; }
    if (password !== confirm)         { setError("Passwords do not match."); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          code: code.trim(),
          newPassword: password,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Reset failed.");
      setStep("done");
      setTimeout(() => navigate("/login"), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed.");
    } finally {
      setLoading(false);
    }
  }

  async function resendCode() {
    await requestCode();
    if (!error) setInfo("A new code has been sent.");
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center space-y-3">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-primary flex items-center justify-center shadow-md">
            <Flame className="w-7 h-7 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              {step === "done" ? "Password updated" : "Reset your password"}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {step === "email" && "Enter your email and we'll send you a one-time code"}
              {step === "verify" && `Enter the 6-digit code we sent to ${email}`}
              {step === "done" && "You can now sign in with your new password"}
            </p>
          </div>
        </div>

        <div className="bg-card border border-border rounded-2xl p-8 shadow-sm space-y-5">
          {step === "email" && (
            <form onSubmit={requestCode} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email" type="email" placeholder="Enter your email"
                  value={email} onChange={e => setEmail(e.target.value)} required autoFocus
                />
              </div>
              {error && (
                <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">{error}</div>
              )}
              <Button type="submit" className="w-full" disabled={loading || !email.trim()}>
                {loading ? "Sending…" : "Send code"}
              </Button>
              <div className="text-center">
                <a href="/app/login" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
                  <ArrowLeft className="w-3.5 h-3.5" /> Back to sign in
                </a>
              </div>
            </form>
          )}

          {step === "verify" && (
            <form onSubmit={submitReset} className="space-y-4">
              <div className="flex items-start gap-3 text-sm bg-primary/5 border border-primary/15 rounded-lg px-3 py-2.5">
                <Mail className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                <p className="text-muted-foreground">
                  We sent a 6-digit code to <strong className="text-foreground">{email}</strong>. It expires in {ttl} minutes.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="code">Verification code</Label>
                <Input
                  id="code" inputMode="numeric" autoComplete="one-time-code"
                  pattern="[0-9]{6}" maxLength={6} placeholder="Enter 6-digit code"
                  value={code} onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  required autoFocus
                  className="text-center text-lg tracking-[0.5em] font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password">New password</Label>
                <Input id="password" type="password" placeholder="Enter at least 8 characters"
                  value={password} onChange={e => setPassword(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm">Confirm password</Label>
                <Input id="confirm" type="password" placeholder="Re-enter your password"
                  value={confirm} onChange={e => setConfirm(e.target.value)} required />
              </div>

              {error && (
                <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">{error}</div>
              )}
              {info && !error && (
                <div className="text-sm text-primary bg-primary/10 border border-primary/20 rounded-lg px-3 py-2">{info}</div>
              )}

              <Button type="submit" className="w-full" disabled={loading}>
                <KeyRound className="w-4 h-4 mr-2" />
                {loading ? "Updating…" : "Update password"}
              </Button>

              <div className="flex items-center justify-between text-sm">
                <button type="button" onClick={() => { setStep("email"); setCode(""); setPassword(""); setConfirm(""); setError(""); setInfo(""); }}
                  className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors">
                  <ArrowLeft className="w-3.5 h-3.5" /> Change email
                </button>
                <button type="button" onClick={resendCode} disabled={loading}
                  className="text-primary hover:underline disabled:opacity-50">
                  Resend code
                </button>
              </div>
            </form>
          )}

          {step === "done" && (
            <div className="text-center space-y-3 py-4">
              <div className="mx-auto w-14 h-14 rounded-full bg-primary/15 flex items-center justify-center">
                <CheckCircle2 className="w-7 h-7 text-primary" />
              </div>
              <p className="font-semibold text-foreground">Password updated!</p>
              <p className="text-sm text-muted-foreground">Redirecting you to sign in…</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
