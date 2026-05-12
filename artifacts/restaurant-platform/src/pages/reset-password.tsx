import { useState, type FormEvent } from "react";
import { useLocation, useSearch } from "wouter";
import { Flame } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

export default function ResetPasswordPage() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const token = new URLSearchParams(search).get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) { setError("Password must be at least 8 characters"); return; }
    if (password !== confirm) { setError("Passwords do not match"); return; }
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/api/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: password }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({ error: "Reset failed" }));
        throw new Error(d.error ?? "Reset failed");
      }
      setDone(true);
      setTimeout(() => navigate("/login"), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center space-y-3">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-primary flex items-center justify-center shadow-md">
            <Flame className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Set new password</h1>
        </div>

        <div className="bg-card border border-border rounded-2xl p-8 shadow-sm">
          {done ? (
            <div className="text-center py-4">
              <p className="font-semibold text-foreground">Password updated!</p>
              <p className="text-sm text-muted-foreground mt-1">Redirecting you to sign in…</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="password">New password</Label>
                <Input id="password" type="password" placeholder="At least 8 characters"
                  value={password} onChange={e => setPassword(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm">Confirm password</Label>
                <Input id="confirm" type="password" placeholder="Repeat your password"
                  value={confirm} onChange={e => setConfirm(e.target.value)} required />
              </div>
              {error && (
                <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}
              {!token && (
                <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
                  Missing reset token. Please use the link from your email.
                </div>
              )}
              <Button type="submit" className="w-full" disabled={loading || !token}>
                {loading ? "Updating…" : "Update password"}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
