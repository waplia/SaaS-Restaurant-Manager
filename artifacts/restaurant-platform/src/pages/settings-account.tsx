import { useState } from "react";
import { SettingsLayout } from "@/components/settings/SettingsLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Lock, Mail, User as UserIcon, CheckCircle2 } from "lucide-react";

export default function SettingsAccountPage() {
  const { user, changePassword } = useAuth();
  const { toast } = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function reset() {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (!currentPassword) {
      setError("Enter your current password.");
      return;
    }
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }
    if (newPassword === currentPassword) {
      setError("New password must be different from the current one.");
      return;
    }

    setSubmitting(true);
    try {
      await changePassword(currentPassword, newPassword);
      setSuccess(true);
      reset();
      toast({ title: "Password changed", description: "Other sessions have been signed out." });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change password");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SettingsLayout activeKey="account" title="Account & Password"
      subtitle="Manage your sign-in details and rotate your password to revoke other sessions.">
      <div className="max-w-2xl space-y-6">
        <section className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3">Signed in as</h3>
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2 text-foreground">
              <UserIcon className="w-4 h-4 text-muted-foreground" />
              <span>{user?.name ?? "—"}</span>
              <span className="text-xs text-muted-foreground capitalize ml-2">({user?.role})</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Mail className="w-4 h-4" />
              <span>{user?.email ?? "—"}</span>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 mb-1">
            <Lock className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">Change password</h3>
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            For your security, changing your password will sign you out of every other device and browser.
          </p>

          <form onSubmit={onSubmit} className="space-y-4" data-testid="change-password-form">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Current password</label>
              <Input
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={e => setCurrentPassword(e.target.value)}
                disabled={submitting}
                data-testid="input-current-password"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">New password</label>
              <Input
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                disabled={submitting}
                data-testid="input-new-password"
              />
              <p className="text-[11px] text-muted-foreground mt-1">At least 8 characters.</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Confirm new password</label>
              <Input
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                disabled={submitting}
                data-testid="input-confirm-password"
              />
            </div>

            {error && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" data-testid="change-password-error">
                {error}
              </div>
            )}
            {success && (
              <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-600 dark:text-emerald-400 flex items-center gap-2" data-testid="change-password-success">
                <CheckCircle2 className="w-4 h-4" />
                Password updated. Other sessions have been signed out.
              </div>
            )}

            <div className="flex items-center gap-2 pt-2">
              <Button type="submit" disabled={submitting} data-testid="submit-change-password">
                {submitting ? "Updating…" : "Update password"}
              </Button>
              <Button type="button" variant="ghost" onClick={reset} disabled={submitting}>
                Clear
              </Button>
            </div>
          </form>
        </section>
      </div>
    </SettingsLayout>
  );
}
