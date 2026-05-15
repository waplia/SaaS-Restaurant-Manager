import { SettingsLayout } from "@/components/settings/SettingsLayout";

const ENDPOINTS = [
  { method: "GET", path: "/api/v1/restaurant", desc: "Get the restaurant linked to your API key." },
  { method: "GET", path: "/api/v1/orders", desc: "List recent orders (?status=pending&limit=50)." },
  { method: "GET", path: "/api/v1/orders/:id", desc: "Fetch a single order by ID." },
  { method: "GET", path: "/api/v1/menu-items", desc: "List menu items for the restaurant." },
  { method: "GET", path: "/api/v1/customers", desc: "List customers (?limit=100)." },
];

const EVENTS = [
  "order.created", "order.updated", "order.completed", "order.cancelled",
  "payment.succeeded", "payment.failed", "menu.updated",
  "reservation.created", "customer.created",
];

const ERRORS = [
  { code: "missing_credentials", http: 401, desc: "No Authorization: Bearer header sent." },
  { code: "invalid_key", http: 401, desc: "Bearer token did not match any key." },
  { code: "revoked_key", http: 401, desc: "Key was revoked by an admin." },
  { code: "api_disabled", http: 503, desc: "Public API is globally disabled by the platform." },
  { code: "rate_limited", http: 429, desc: "Per-key/per-restaurant rate limit exceeded." },
  { code: "not_found", http: 404, desc: "Resource not found or not in your restaurant." },
];

const SIG_SAMPLE = `// Verify X-Signature header (Node.js)
import crypto from "crypto";

function verify(secret, signatureHeader, rawBody) {
  // Header format: "t=<unix_seconds>,v1=<hex_hmac>"
  const parts = Object.fromEntries(
    signatureHeader.split(",").map(p => p.split("="))
  );
  const expected = crypto
    .createHmac("sha256", secret)
    .update(\`\${parts.t}.\${rawBody}\`)
    .digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(parts.v1)
  );
}`;

const REQ_SAMPLE = `curl https://your-domain.com/api/v1/orders \\
  -H "Authorization: Bearer kl_live_..." \\
  -H "Accept: application/json"`;

export default function DeveloperDocsPage() {
  return (
    <SettingsLayout activeKey="developer-docs" title="Developer Documentation" subtitle="Build integrations against the Khana Lagao API.">
      <div className="prose prose-sm dark:prose-invert max-w-none space-y-8">
        <section>
          <h2 className="text-lg font-semibold">Authentication</h2>
          <p className="text-sm">Authenticate every request with a Bearer API key. Generate keys from the <strong>API Keys</strong> page; the full key is shown only once.</p>
          <pre className="bg-muted/40 border border-border rounded p-3 text-xs overflow-auto"><code>Authorization: Bearer kl_live_xxxxxxxxxxxxxxxxxxxxxxxx</code></pre>
        </section>

        <section>
          <h2 className="text-lg font-semibold">Base URL</h2>
          <pre className="bg-muted/40 border border-border rounded p-3 text-xs overflow-auto"><code>{typeof window !== "undefined" ? window.location.origin : ""}/api/v1</code></pre>
        </section>

        <section>
          <h2 className="text-lg font-semibold">Rate limits</h2>
          <p className="text-sm">Default: <strong>60 requests/minute</strong> per key (configurable per-key and per-restaurant). When exceeded, requests return <code className="text-xs">HTTP 429</code> with <code className="text-xs">{`{ "error": { "code": "rate_limited" } }`}</code>. Headers <code className="text-xs">X-RateLimit-Limit</code> and <code className="text-xs">X-RateLimit-Remaining</code> are included on every response.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">Endpoints</h2>
          <table className="w-full text-sm border border-border rounded">
            <thead className="bg-muted/40 text-xs">
              <tr><th className="text-left px-3 py-2">Method</th><th className="text-left px-3 py-2">Path</th><th className="text-left px-3 py-2">Description</th></tr>
            </thead>
            <tbody>
              {ENDPOINTS.map(e => (
                <tr key={e.path} className="border-t border-border">
                  <td className="px-3 py-2"><span className="font-mono text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary">{e.method}</span></td>
                  <td className="px-3 py-2 font-mono text-xs">{e.path}</td>
                  <td className="px-3 py-2 text-xs">{e.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <h2 className="text-lg font-semibold">Example request</h2>
          <pre className="bg-muted/40 border border-border rounded p-3 text-xs overflow-auto"><code>{REQ_SAMPLE}</code></pre>
          <h3 className="text-sm font-semibold mt-3">Example response</h3>
          <pre className="bg-muted/40 border border-border rounded p-3 text-xs overflow-auto"><code>{`{
  "data": [
    { "id": 42, "orderNumber": "ORD-0042", "status": "pending", "totalAmount": "350.00" }
  ]
}`}</code></pre>
        </section>

        <section>
          <h2 className="text-lg font-semibold">Webhooks</h2>
          <p className="text-sm">Configure endpoints from the <strong>Webhooks</strong> page. Every event is delivered as a signed POST to your URL.</p>
          <p className="text-sm">Headers sent with each delivery:</p>
          <ul className="text-sm list-disc pl-5">
            <li><code className="text-xs">X-Signature</code> — HMAC-SHA256 of <code className="text-xs">{`<timestamp>.<body>`}</code></li>
            <li><code className="text-xs">X-Webhook-Event</code> — event type (e.g. <code className="text-xs">order.created</code>)</li>
            <li><code className="text-xs">X-Webhook-Delivery</code> — unique delivery ID</li>
          </ul>
          <h3 className="text-sm font-semibold mt-3">Subscribed events</h3>
          <div className="flex flex-wrap gap-1.5">
            {EVENTS.map(e => <code key={e} className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary font-mono">{e}</code>)}
          </div>
          <p className="text-sm mt-3">Failed deliveries (non-2xx response or network error) are retried with exponential backoff up to the platform-configured maximum, then marked permanently failed.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">Verifying signatures</h2>
          <pre className="bg-muted/40 border border-border rounded p-3 text-xs overflow-auto"><code>{SIG_SAMPLE}</code></pre>
        </section>

        <section>
          <h2 className="text-lg font-semibold">Error codes</h2>
          <table className="w-full text-sm border border-border rounded">
            <thead className="bg-muted/40 text-xs">
              <tr><th className="text-left px-3 py-2">Code</th><th className="text-left px-3 py-2">HTTP</th><th className="text-left px-3 py-2">Meaning</th></tr>
            </thead>
            <tbody>
              {ERRORS.map(e => (
                <tr key={e.code} className="border-t border-border">
                  <td className="px-3 py-2 font-mono text-xs">{e.code}</td>
                  <td className="px-3 py-2 text-xs">{e.http}</td>
                  <td className="px-3 py-2 text-xs">{e.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </SettingsLayout>
  );
}
