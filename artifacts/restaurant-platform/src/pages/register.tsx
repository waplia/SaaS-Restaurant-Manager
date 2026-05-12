import { useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { Flame, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";

const FEATURES = [
  "14-day free trial — no credit card required",
  "POS, kitchen display, QR ordering included",
  "Multi-branch & staff management",
  "Inventory and customer loyalty built-in",
];

export default function RegisterPage() {
  const { register } = useAuth();
  const [, navigate] = useLocation();
  const [form, setForm] = useState({ restaurantName: "", ownerName: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function set(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm(prev => ({ ...prev, [field]: e.target.value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (form.password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await register(form);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-4xl grid md:grid-cols-2 gap-10 items-center">
        <div className="space-y-6 hidden md:block">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
              <Flame className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold text-foreground">TableTrack</span>
          </div>
          <div className="space-y-2">
            <h1 className="text-3xl font-bold text-foreground leading-tight">
              The all-in-one platform for modern restaurants
            </h1>
            <p className="text-muted-foreground">
              Everything you need to run your restaurant — from table management to kitchen display to customer loyalty.
            </p>
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
            <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center">
              <Flame className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-lg">TableTrack</span>
          </div>
          <div>
            <h2 className="text-xl font-semibold text-foreground">Create your account</h2>
            <p className="text-sm text-muted-foreground mt-1">Start your 14-day free trial</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="restaurantName">Restaurant name</Label>
              <Input
                id="restaurantName"
                placeholder="Spice Garden"
                value={form.restaurantName}
                onChange={set("restaurantName")}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ownerName">Your name</Label>
              <Input
                id="ownerName"
                placeholder="Priya Sharma"
                value={form.ownerName}
                onChange={set("ownerName")}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Work email</Label>
              <Input
                id="email"
                type="email"
                placeholder="priya@spicegarden.com"
                value={form.email}
                onChange={set("email")}
                required
                autoComplete="email"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="At least 8 characters"
                value={form.password}
                onChange={set("password")}
                required
                autoComplete="new-password"
              />
            </div>

            {error && (
              <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Creating account…" : "Start free trial"}
            </Button>
          </form>

          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <a href="/login" className="text-primary font-medium hover:underline">
              Sign in
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
