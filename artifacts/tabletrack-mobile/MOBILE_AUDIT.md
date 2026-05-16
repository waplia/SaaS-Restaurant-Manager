# KhanaLagao Mobile App — Audit

## Scope
Upgraded the owner role of `@workspace/tabletrack-mobile` (Expo) into a full
restaurant-ops command center backed by the real `@workspace/api-client-react`
hooks and `customFetch` — no mock data.

## Navigation
`app/(owner)/_layout.tsx` exposes 5 visible tabs: **Home / Orders / Kitchen /
Alerts / More**. All other modules are registered as hidden routes
(`href: null`) and reached from the More screen.

## Screens built
Home (index), Orders, Kitchen, Alerts, More, Notifications, Approvals, Tables,
Reservations, Waiter Requests, Delivery, Inventory, Menu, Staff, Attendance,
Customers, Feedback, Growth, Khana AI hub + Chat, Finance, Reports, Outlets,
Settings, Support, Expenses, Profile.

Every screen uses:
- `useQuery` over `customFetch` with bearer auth
- pull-to-refresh, `ListSkeleton` loading, `EmptyState` empty/error
- brand colors from `constants/brand.ts`
- `RoleGate` where backend RBAC is enforced (mirrors `lib/roles.ts`)

## Shared building blocks
- `lib/roles.ts` — `StaffRole`, `ModuleKey`, `rolesAllow()`, `ROLE_LABEL`
- `constants/brand.ts` — KhanaLagao primary `#FF6B1A`, AI `#7C3AED`
- `components/`: `StatusBadge`, `SectionHeader`, `MenuListRow`, `RoleGate`,
  `OfflineBanner`, `AICreditChip`, `ListSkeleton`, `MiniBarChart`

## Drift / deferred
- Barcode scan & biometric lock: UI stubs only (native modules wired later).
- Outlet switching: list view; switching still requires re-login.
- Reports screen is a hub (revenue trend + popular items); deep report
  builders remain on the web admin.
- Customer / Waiter / Delivery role tabs were not refactored in this pass.
