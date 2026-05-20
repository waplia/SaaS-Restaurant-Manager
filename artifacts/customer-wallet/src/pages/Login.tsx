import { useState } from "react";
import { Wallet } from "lucide-react";
import { api, setToken } from "@/lib/api";
import { useAuth, type CustomerUser } from "@/lib/auth";
import { PhoneInput } from "@/components/PhoneInput";

type Stage = "phone" | "otp" | "register";

interface ApiErrorShape extends Error {
  status?: number;
  body?: unknown;
}

function isAccountNotRegistered(err: unknown): boolean {
  const e = err as ApiErrorShape;
  if (e?.status !== 404) return false;
  const body = e.body;
  if (body && typeof body === "object" && "code" in body) {
    return (body as { code?: string }).code === "account_not_registered";
  }
  return true;
}

export default function Login() {
  const { refresh, setUser } = useAuth();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [stage, setStage] = useState<Stage>("phone");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);

  async function requestOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setLoading(true);
    try {
      const r = await api<{ ok: boolean; devCode?: string }>("/wallet/auth/request-otp", {
        method: "POST", body: JSON.stringify({ phone }),
      });
      setDevCode(r.devCode ?? null);
      setStage("otp");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send code");
    } finally { setLoading(false); }
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setLoading(true);
    try {
      const r = await api<{ ok: boolean; token: string; customerUser: CustomerUser }>(
        "/wallet/auth/verify-otp",
        { method: "POST", body: JSON.stringify({ phone, code }) },
      );
      setToken(r.token);
      setUser(r.customerUser);
      await refresh();
    } catch (err) {
      // The server signals "no account exists for this phone" with HTTP 404
      // and body.code === "account_not_registered". Route the user to the
      // register step instead of silently creating an account on login.
      if (isAccountNotRegistered(err)) {
        setError(null);
        setStage("register");
      } else {
        setError(err instanceof Error ? err.message : "Invalid code");
      }
    } finally { setLoading(false); }
  }

  async function registerAccount(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setLoading(true);
    try {
      const r = await api<{ ok: boolean; token: string; customerUser: CustomerUser }>(
        "/wallet/auth/register",
        { method: "POST", body: JSON.stringify({ phone, code, name: name.trim() }) },
      );
      setToken(r.token);
      setUser(r.customerUser);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create account");
    } finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-[rgb(var(--accent))] to-[rgb(var(--bg))]">
      <div className="container-app flex-1 flex flex-col justify-center py-12">
        <div className="flex flex-col items-center mb-10">
          <div className="w-16 h-16 rounded-3xl bg-[rgb(var(--primary))] text-white flex items-center justify-center mb-4 shadow-lg">
            <Wallet size={30} />
          </div>
          <h1 className="text-3xl font-semibold text-center">TableTrack Wallet</h1>
          <p className="text-zinc-600 text-center mt-2">Your loyalty across every restaurant.</p>
        </div>

        {stage === "phone" && (
          <form onSubmit={requestOtp} className="card p-6 space-y-4" data-testid="form-phone">
            <label className="block">
              <span className="text-sm font-medium">Mobile number</span>
              <div className="mt-2">
                <PhoneInput
                  value={phone}
                  onChange={setPhone}
                  required
                  placeholder="98765 43210"
                  inputTestId="input-phone"
                  autoFocus
                />
              </div>
            </label>
            {error && <p className="text-sm text-red-600" data-testid="text-error">{error}</p>}
            <button className="btn-primary w-full" disabled={loading} data-testid="button-send-otp">
              {loading ? "Sending…" : "Send OTP"}
            </button>
            <p className="text-xs text-zinc-500 text-center">
              We'll text you a 6-digit code. Standard SMS rates apply.
            </p>
          </form>
        )}

        {stage === "otp" && (
          <form onSubmit={verifyOtp} className="card p-6 space-y-4" data-testid="form-otp">
            <div>
              <p className="text-sm text-zinc-600">Enter the code we sent to</p>
              <p className="font-medium">{phone}</p>
            </div>
            <input
              className="input tracking-[0.4em] text-center font-mono text-lg"
              type="text" inputMode="numeric" maxLength={6} required
              placeholder="••••••"
              value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))}
              data-testid="input-otp" autoFocus
            />
            {devCode && (
              <p className="text-xs bg-yellow-50 text-yellow-800 border border-yellow-200 rounded-lg px-3 py-2">
                Dev mode code: <span className="font-mono font-bold">{devCode}</span>
              </p>
            )}
            {error && <p className="text-sm text-red-600" data-testid="text-error">{error}</p>}
            <button className="btn-primary w-full" disabled={loading || code.length < 4} data-testid="button-verify-otp">
              {loading ? "Verifying…" : "Verify & sign in"}
            </button>
            <button type="button" className="text-sm text-zinc-500 w-full text-center"
              onClick={() => { setStage("phone"); setCode(""); setError(null); setDevCode(null); }}
              data-testid="button-change-number">
              Use a different number
            </button>
          </form>
        )}

        {stage === "register" && (
          <form onSubmit={registerAccount} className="card p-6 space-y-4" data-testid="form-register">
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
              <p className="text-sm font-medium text-amber-900">No account yet for {phone}</p>
              <p className="text-xs text-amber-800 mt-1">
                Enter your name below to create your wallet account. We'll use the code you
                already verified — no need to request another one.
              </p>
            </div>
            <label className="block">
              <span className="text-sm font-medium">Your name</span>
              <input
                className="input mt-2"
                type="text" required maxLength={80}
                placeholder="e.g. Priya Sharma"
                value={name} onChange={e => setName(e.target.value)}
                data-testid="input-name" autoFocus
              />
            </label>
            {error && <p className="text-sm text-red-600" data-testid="text-error-register">{error}</p>}
            <button className="btn-primary w-full" disabled={loading || name.trim().length < 2}
              data-testid="button-register">
              {loading ? "Creating account…" : "Create account & sign in"}
            </button>
            <button type="button" className="text-sm text-zinc-500 w-full text-center"
              onClick={() => { setStage("phone"); setCode(""); setName(""); setError(null); setDevCode(null); }}
              data-testid="button-cancel-register">
              Use a different number
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
