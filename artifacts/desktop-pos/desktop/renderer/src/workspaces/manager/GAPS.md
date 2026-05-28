# Manager Office — backend gap notes

The Manager Office desktop workspace ships every nav module from the
spec in this build. Modules without a native desktop IPC channel
render `WebAdminBridge`, which **embeds** the matching web-admin page
inside the Manager pane via Electron's `<webview>` tag (default
session, shared cookie jar). The operator never leaves the shell — an
"Open externally" affordance is available but optional.

Plan-feature flags are resolved through `plan:features` IPC, which
calls the authenticated `/api/restaurants/:id/subscription` endpoint
via the main-process `ApiClient`. The renderer must **not** fetch
`/api/...` directly — the auth tokens live in main and renderer fetch
would 401, hiding every gated module. Always go through the preload
bridge (`window.khanalagao.plan.features`).

This file tracks the native IPC work that would let us drop each
`WebAdminBridge` and ship a real desktop screen. The registry swap is
a one-line change once the IPC lands.

| Nav key      | Needed IPC surface (suggested channels)                              |
|--------------|----------------------------------------------------------------------|
| `inventory`  | `inventory:items`, `inventory:adjust`, `inventory:audit`, `inventory:recipes`, `inventory:low-stock` |
| `purchase`   | `purchase:requests:list/create`, `purchase:suppliers:list`, `purchase:receive` |
| `staff`      | `staff:list/create/update`, `staff:roles`, `staff:attendance`, `staff:tasks` |
| `finance`    | `finance:expenses:list/create`, `finance:books:summary`, `finance:settlements`, `finance:tax-returns` |
| `growth`     | `growth:campaigns`, `growth:coupons`, `growth:loyalty:programs`, `growth:leads`, `growth:reviews` |
| `providers`  | `providers:list`, `providers:configure`, `providers:webhooks`, `api-keys:list/create/revoke` |
| `ai`         | `ai:menu-import`, `ai:descriptions`, `ai:images`, `ai:insights`, `ai:forecasts` |

## Embedded settings deep-links

`SettingsHub` covers connection / appearance / hardware / sync / system
natively. The remaining settings tree is embedded via `WebAdminBridge`
until desktop IPC lands:

- Outlet & branches  (`/settings/account`, `/settings/subscription`)
- Counters           (`/settings/counters`)
- Kitchens           (`/settings/kitchens`, `/settings/printers`)
- Bill / KOT templates (`/settings/bill-templates`)
- Accounting target  (`/settings/accounting`)
- WhatsApp           (`/settings/whatsapp`)
- Web push           (`/settings/web-push`)
- Devices & sessions (`/settings/devices`, `/settings/sessions`, `/settings/terminals`)
- API keys & webhooks (`/settings/api-keys`, `/settings/webhooks`, `/settings/webhook-logs`, `/settings/api-logs`)

## Auth & session expectations (embedded webview)

- Webview runs in the default session so the same cookie that the
  desktop ApiClient writes on login is sent to the embedded
  `/restaurant/*` pages. Do not mount the webview in a partition.
- `will-attach-webview` is hardened in `main/index.ts`: `nodeIntegration`
  off, `contextIsolation` on, navigation restricted to the configured
  `apiBaseUrl` origin.
- Plan gating happens in the renderer **shell** (nav rail + Back
  Office index). It is *not* a security boundary — the API still
  enforces feature/permission checks on every request.

## Notes on reused cashier IPC
