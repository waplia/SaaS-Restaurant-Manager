import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import { GraduationCap, QrCode, Wallet, ShieldAlert, BarChart3, Users } from "lucide-react";

export default function CanteenHelpPage() {
  return (
    <Layout>
      <PageHeader title="Canteen Help" subtitle="A quick guide to running the canteen module" />
      <div className="m-6 max-w-3xl space-y-4">
        <Section icon={GraduationCap} title="1. Add students">
          Open <b>Canteen → Students</b> and click <b>New Student</b>. Each student gets a
          unique QR token automatically — print it onto the school ID card.
          You can set a per-student daily spending cap and a low-balance alert
          threshold; both fall back to the restaurant defaults.
        </Section>

        <Section icon={Users} title="2. Link parents/guardians">
          From a student's detail panel, add one or more guardians with phone or
          email. Each guardian gets a personal magic link of the form
          <code className="bg-muted px-1 rounded ml-1">/canteen/parent/&lt;token&gt;</code>
          — share it via SMS, email, or WhatsApp.
        </Section>

        <Section icon={Wallet} title="3. Recharge wallets">
          Parents recharge from their own dashboard, or counter staff can do
          a manual recharge from the <b>Students</b> screen. Every credit and
          debit is recorded in the wallet ledger for full traceability.
        </Section>

        <Section icon={QrCode} title="4. Sell at the counter">
          Open <b>Canteen → Counter POS</b>. Scan or paste the student's QR
          token. The screen shows balance, daily-spend remaining, and any
          restricted items (in red). Add menu items, pick wallet or cash,
          and place the order — the wallet is debited atomically.
        </Section>

        <Section icon={ShieldAlert} title="5. Restrictions and meal plans">
          Use <b>Meal Plans &amp; Restrictions</b> to block junk-food categories,
          define class-level restrictions, or sell monthly subscription plans
          that include a daily allowance.
        </Section>

        <Section icon={BarChart3} title="6. Notifications and reports">
          Guardians receive automatic email/SMS/WhatsApp alerts on every
          purchase and when the balance dips below the threshold. The
          monthly <b>Reports</b> page exports a CSV of all orders and
          recharges.
        </Section>
      </div>
    </Layout>
  );
}

function Section({ icon: Icon, title, children }: { icon: typeof GraduationCap; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center gap-2 font-semibold mb-2"><Icon className="w-4 h-4" />{title}</div>
      <div className="text-sm text-muted-foreground leading-relaxed">{children}</div>
    </div>
  );
}
