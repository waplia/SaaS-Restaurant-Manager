/**
 * Marketing workspace screens.
 *
 * Wired to the growth-engine and reviews endpoints. Channel-filtered
 * campaign screens (WhatsApp / SMS / Email / Push) reuse the same
 * `CampaignsScreen` with a fixed channel filter so the underlying
 * data path stays single-sourced.
 */
import { useMemo, useState } from "react";
import {
  PageShell, Empty, ErrorBox, Skeleton, useAsync, Drawer, Field, Stat, StatRow,
  DataTable, Button, Input, colors, fmtMoney, fmtDate, StatusPill, PendingBackend,
} from "./shared";

interface Campaign {
  id: number; name: string; status: string; channel: string; type: string; goal?: string;
  scheduledAt?: string | null; createdAt?: string;
  stats?: { sent?: number; delivered?: number; opened?: number; clicked?: number; converted?: number; revenue?: number };
}
interface Template { id: number; name: string; channel: string; body?: string; subject?: string | null; }
interface ReviewFeedback { id: number; rating: number; comment?: string | null; customerName?: string | null; createdAt?: string; sentiment?: string | null; }
interface ReviewExternal { id: number; platform: string; rating?: number | null; reviewerName?: string | null; reviewText?: string | null; reviewDate?: string | null; }
interface RecoveryTask { id: number; status: string; orderId?: number; customerName?: string | null; rating?: number | null; createdAt?: string; }

const num = (v: unknown) => Number(v ?? 0) || 0;

// ─── Growth engine dashboard ──────────────────────────────────────────────
export function GrowthEngineScreen() {
  const a = useAsync<{
    total?: number;
    byStatus?: Record<string, number>;
    byChannel?: Record<string, number>;
    byType?: Record<string, number>;
    byGoal?: Record<string, number>;
    sends?: { sent?: number; converted?: number; failed?: number };
  }>(() => window.khanalagao.mkt.analytics() as Promise<{ total: number }>, []);
  const logs = useAsync<Array<{ id: number; event: string; createdAt: string; payload?: unknown }>>(
    () => window.khanalagao.mkt.logs({ limit: 30 }) as Promise<Array<{ id: number; event: string; createdAt: string }>>, [],
  );

  return (
    <PageShell title="Growth Engine" actions={<Button onClick={() => { a.reload(); logs.reload(); }}>Refresh</Button>}>
      {a.error && <ErrorBox message={a.error} onRetry={a.reload} />}
      {a.loading && !a.data && <Skeleton rows={3} />}
      {a.data && (
        <>
          <StatRow>
            <Stat label="Campaigns" value={a.data.total ?? 0} />
            <Stat label="Sent" value={a.data.sends?.sent ?? 0} />
            <Stat label="Converted" value={a.data.sends?.converted ?? 0} />
            <Stat label="Failed" value={a.data.sends?.failed ?? 0} />
          </StatRow>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 18 }}>
            <BreakdownCard title="By channel" data={a.data.byChannel ?? {}} />
            <BreakdownCard title="By status"  data={a.data.byStatus ?? {}} />
            <BreakdownCard title="By type"    data={a.data.byType ?? {}} />
            <BreakdownCard title="By goal"    data={a.data.byGoal ?? {}} />
          </div>
        </>
      )}
      <h3 style={{ color: colors.textPrimary, fontSize: 14, marginTop: 18, marginBottom: 8 }}>Recent activity</h3>
      {logs.loading && !logs.data && <Skeleton rows={3} />}
      {logs.data && (
        <DataTable
          rowKey={(r) => r.id}
          rows={logs.data}
          empty={<Empty title="No campaign activity yet" />}
          columns={[
            { key: "when", header: "When", render: (r) => fmtDate(r.createdAt) },
            { key: "event", header: "Event", render: (r) => <code style={{ fontSize: 11, color: colors.textDim }}>{r.event}</code> },
          ]}
        />
      )}
    </PageShell>
  );
}

function BreakdownCard({ title, data }: { title: string; data: Record<string, number> }) {
  const total = Object.values(data).reduce((s, n) => s + n, 0);
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  return (
    <div style={{ padding: 12, background: colors.panel, borderRadius: 10, border: `1px solid ${colors.border}` }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, color: colors.textMuted, marginBottom: 8 }}>{title}</div>
      {entries.length === 0 ? (
        <div style={{ color: colors.textDim, fontSize: 12 }}>No data</div>
      ) : entries.map(([k, v]) => {
        const pct = total ? Math.round((v / total) * 100) : 0;
        return (
          <div key={k} style={{ marginBottom: 8 }}>
            <div style={{ display: "flex", fontSize: 12, color: colors.textPrimary, marginBottom: 3 }}>
              <span style={{ flex: 1, textTransform: "capitalize" }}>{k}</span>
              <span style={{ color: colors.textDim }}>{v} · {pct}%</span>
            </div>
            <div style={{ height: 4, background: colors.bg, borderRadius: 2, overflow: "hidden" }}>
              <div style={{ width: `${pct}%`, height: "100%", background: colors.brand }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Campaigns list (also reused for channel-filtered nav items) ───────────
export function CampaignsScreen({ channelFilter, title }: { channelFilter?: string; title?: string }) {
  const [statusFilter, setStatusFilter] = useState("");
  const [q, setQ] = useState("");
  const { data, loading, error, reload } = useAsync<Campaign[]>(
    () => window.khanalagao.mkt.campaigns({
      channel: channelFilter, status: statusFilter || undefined, q: q || undefined,
    }) as Promise<Campaign[]>,
    [channelFilter, statusFilter, q],
  );
  const [busy, setBusy] = useState(false);
  const newDraft = async () => {
    setBusy(true);
    try {
      await window.khanalagao.mkt.draft({ channel: channelFilter ?? "email" });
      reload();
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return (
    <PageShell
      title={title ?? "Campaigns"}
      actions={
        <>
          <Input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 220 }} />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            style={{ background: colors.bg, color: colors.textPrimary, padding: "8px 12px", border: `1px solid ${colors.borderStrong}`, borderRadius: 8, fontSize: 13 }}>
            <option value="">All statuses</option>
            <option value="draft">Draft</option><option value="scheduled">Scheduled</option>
            <option value="active">Active</option><option value="paused">Paused</option>
            <option value="completed">Completed</option>
          </select>
          <Button onClick={newDraft} disabled={busy}>{busy ? "Creating…" : "+ New campaign"}</Button>
        </>
      }
    >
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <Skeleton />}
      {data && (
        <DataTable<Campaign>
          rowKey={(r) => r.id}
          rows={data}
          empty={<Empty title="No campaigns yet" hint='Click "+ New campaign" to start a draft. You can finish setup in the admin web app.' />}
          columns={[
            { key: "name", header: "Name", render: (r) => <span style={{ fontWeight: 600 }}>{r.name}</span> },
            { key: "channel", header: "Channel", render: (r) => r.channel },
            { key: "type", header: "Type", render: (r) => r.type },
            { key: "status", header: "Status", render: (r) => {
              const tone = r.status === "active" ? "ok" : r.status === "completed" ? "info"
                : r.status === "draft" ? "warn" : r.status === "paused" ? "bad" : "info";
              return <StatusPill status={r.status} tone={tone} />;
            } },
            { key: "sent", header: "Sent", align: "right", render: (r) => r.stats?.sent ?? 0 },
            { key: "conv", header: "Converted", align: "right", render: (r) => r.stats?.converted ?? 0 },
            { key: "rev", header: "Revenue", align: "right", render: (r) => fmtMoney(r.stats?.revenue ?? 0) },
            { key: "sched", header: "Scheduled", render: (r) => r.scheduledAt ? fmtDate(r.scheduledAt) : "—" },
          ]}
        />
      )}
    </PageShell>
  );
}

// ─── Templates (per channel) ──────────────────────────────────────────────
export function TemplatesScreen({ channel, title }: { channel: string; title?: string }) {
  const { data, loading, error, reload } = useAsync<Template[]>(
    () => window.khanalagao.mkt.templates({ channel }) as Promise<Template[]>, [channel],
  );
  return (
    <PageShell title={title ?? `Templates · ${channel}`} actions={<Button onClick={reload}>Refresh</Button>}>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <Skeleton />}
      {data && (
        <DataTable<Template>
          rowKey={(r) => r.id}
          rows={data}
          empty={<Empty title="No templates" hint="Create templates from the admin web app — they'll appear here for campaign reuse." />}
          columns={[
            { key: "name", header: "Name", render: (r) => <span style={{ fontWeight: 600 }}>{r.name}</span> },
            { key: "channel", header: "Channel", render: (r) => r.channel },
            { key: "subject", header: "Subject / preview", render: (r) =>
              <span style={{ color: colors.textDim }}>{r.subject || (r.body ?? "").slice(0, 80) || "—"}</span> },
          ]}
        />
      )}
    </PageShell>
  );
}

// ─── Reviews (combined feedback + external) ───────────────────────────────
export function ReviewsScreen() {
  const fb = useAsync<ReviewFeedback[]>(() => window.khanalagao.mkt.reviewsFeedback({ limit: 50 }) as Promise<ReviewFeedback[]>, []);
  const ext = useAsync<ReviewExternal[]>(() => window.khanalagao.mkt.reviewsExternal({ limit: 50 }) as Promise<ReviewExternal[]>, []);
  const rec = useAsync<RecoveryTask[]>(() => window.khanalagao.mkt.reviewsRecovery({}) as Promise<RecoveryTask[]>, []);
  const avg = useMemo(() => {
    const all = (fb.data ?? []).map((r) => num(r.rating)).filter((n) => n > 0);
    return all.length ? (all.reduce((s, n) => s + n, 0) / all.length) : 0;
  }, [fb.data]);

  return (
    <PageShell title="Reviews & feedback" actions={
      <Button onClick={() => { fb.reload(); ext.reload(); rec.reload(); }}>Refresh</Button>
    }>
      <StatRow>
        <Stat label="Avg rating (internal)" value={avg ? `${avg.toFixed(2)} ★` : "—"} hint={`${fb.data?.length ?? 0} feedback entries`} />
        <Stat label="External reviews" value={ext.data?.length ?? 0} />
        <Stat label="Recovery tasks" value={rec.data?.length ?? 0} hint="open follow-ups" />
      </StatRow>

      <h3 style={{ color: colors.textPrimary, fontSize: 14, marginTop: 12, marginBottom: 8 }}>Customer feedback</h3>
      {fb.error && <ErrorBox message={fb.error} onRetry={fb.reload} />}
      {fb.loading && !fb.data && <Skeleton rows={3} />}
      {fb.data && (
        <DataTable<ReviewFeedback>
          rowKey={(r) => r.id}
          rows={fb.data}
          empty={<Empty title="No customer feedback yet" />}
          columns={[
            { key: "when", header: "When", render: (r) => fmtDate(r.createdAt) },
            { key: "rating", header: "Rating", render: (r) => "★".repeat(Math.max(0, Math.round(num(r.rating)))) },
            { key: "customer", header: "Customer", render: (r) => r.customerName ?? "—" },
            { key: "sentiment", header: "Sentiment", render: (r) => r.sentiment
              ? <StatusPill status={r.sentiment} tone={r.sentiment === "positive" ? "ok" : r.sentiment === "negative" ? "bad" : "info"} />
              : "—" },
            { key: "comment", header: "Comment", render: (r) =>
              <span style={{ color: colors.textDim }}>{(r.comment ?? "").slice(0, 80) || "—"}</span> },
          ]}
        />
      )}

      <h3 style={{ color: colors.textPrimary, fontSize: 14, marginTop: 24, marginBottom: 8 }}>External reviews</h3>
      {ext.error && <ErrorBox message={ext.error} onRetry={ext.reload} />}
      {ext.data && (
        <DataTable<ReviewExternal>
          rowKey={(r) => r.id}
          rows={ext.data}
          empty={<Empty title="No external reviews tracked" hint="Connect Google / Zomato review sources from the admin app." />}
          columns={[
            { key: "platform", header: "Platform", render: (r) => r.platform },
            { key: "rating", header: "Rating", align: "right", render: (r) => r.rating != null ? `${r.rating} ★` : "—" },
            { key: "name", header: "Reviewer", render: (r) => r.reviewerName ?? "—" },
            { key: "when", header: "When", render: (r) => fmtDate(r.reviewDate) },
            { key: "text", header: "Excerpt", render: (r) => <span style={{ color: colors.textDim }}>{(r.reviewText ?? "").slice(0, 80) || "—"}</span> },
          ]}
        />
      )}
    </PageShell>
  );
}

// ─── Coupons — validate path is read-only on desktop ──────────────────────
export function CouponsScreen() {
  const [code, setCode] = useState("");
  const [result, setResult] = useState<{ valid: boolean; discount?: number; reason?: string; message?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const validate = async () => {
    setBusy(true); setErr(null); setResult(null);
    try {
      const r = await window.khanalagao.mkt.couponsValidate({ code: code.trim() }) as { valid: boolean; discount?: number; reason?: string };
      setResult(r);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return (
    <PageShell title="Coupons">
      <div style={{ maxWidth: 540 }}>
        <Field label="Coupon code">
          <div style={{ display: "flex", gap: 8 }}>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. WELCOME10" />
            <Button onClick={validate} disabled={busy || !code.trim()}>{busy ? "…" : "Validate"}</Button>
          </div>
        </Field>
        {err && <ErrorBox message={err} />}
        {result && (
          <div style={{
            padding: 14, borderRadius: 10, marginTop: 14,
            background: result.valid ? "#0b3d20" : "#3a0d0d",
            border: `1px solid ${result.valid ? "#16a34a" : "#dc2626"}`,
            color: colors.textPrimary,
          }}>
            {result.valid ? (
              <>✓ Valid coupon — discount {result.discount != null ? fmtMoney(result.discount) : "applied"}</>
            ) : (
              <>✗ {result.reason ?? result.message ?? "Invalid coupon"}</>
            )}
          </div>
        )}
        <div style={{ marginTop: 22, padding: 14, background: colors.panel, borderRadius: 10, border: `1px solid ${colors.border}`, color: colors.textDim, fontSize: 12, lineHeight: 1.6 }}>
          Coupon creation and lifecycle management run from the admin web app
          (super-admin scope). This screen lets you sanity-check a code before
          a customer redeems it at the till.
        </div>
      </div>
    </PageShell>
  );
}

// ─── Pending-backend modules ─────────────────────────────────────────────
export const SegmentsScreen = () => (
  <PageShell title="Customer segments">
    <PendingBackend
      feature="Customer segment builder (list/preview)"
      quickActions={["Build segment", "Preview audience", "Save segment"]}
    />
  </PageShell>
);
