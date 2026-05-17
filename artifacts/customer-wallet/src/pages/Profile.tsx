import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Header } from "@/components/Layout";
import { useAuth, type CustomerUser } from "@/lib/auth";
import { LogOut, ShieldCheck } from "lucide-react";

export default function Profile() {
  const { user, signOut, setUser } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [saved, setSaved] = useState(false);

  const mut = useMutation({
    mutationFn: () => api<{ customerUser: CustomerUser }>("/wallet/me", {
      method: "PATCH", body: JSON.stringify({ name, email }),
    }),
    onSuccess: (r) => {
      setUser(r.customerUser);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      void qc.invalidateQueries({ queryKey: ["wallet-summary"] });
    },
  });

  return (
    <>
      <Header title="Profile" subtitle="Manage your TableTrack identity." />
      <section className="container-app">
        <div className="card p-5">
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-2xl bg-[rgb(var(--accent))] text-[rgb(var(--primary))] flex items-center justify-center font-semibold text-xl">
              {(user?.name ?? user?.phone ?? "?").charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="font-medium" data-testid="text-phone">{user?.phone}</p>
              <p className="text-xs text-zinc-500 flex items-center gap-1">
                <ShieldCheck size={12} /> Verified by SMS
              </p>
            </div>
          </div>
        </div>

        <form
          className="card p-5 mt-4 space-y-4"
          onSubmit={(e) => { e.preventDefault(); mut.mutate(); }}
        >
          <label className="block">
            <span className="text-sm font-medium">Name</span>
            <input className="input mt-2" value={name} onChange={e => setName(e.target.value)} data-testid="input-name" />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Email</span>
            <input className="input mt-2" type="email" value={email} onChange={e => setEmail(e.target.value)} data-testid="input-email" />
          </label>
          {saved && <p className="text-sm text-emerald-600">Saved.</p>}
          <button className="btn-primary w-full" disabled={mut.isPending} data-testid="button-save-profile">
            {mut.isPending ? "Saving…" : "Save changes"}
          </button>
        </form>

        <button
          onClick={signOut}
          className="btn-outline w-full mt-6 text-red-600 border-red-200"
          data-testid="button-sign-out"
        >
          <LogOut size={16} className="mr-2" /> Sign out
        </button>
      </section>
    </>
  );
}
