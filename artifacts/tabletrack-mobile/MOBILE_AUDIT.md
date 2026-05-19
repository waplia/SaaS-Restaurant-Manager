# KhanaLagao Mobile App — Audit

## Scope
Upgraded the owner role of `@workspace/tabletrack-mobile` (Expo) into a full
restaurant-ops command center backed by the real `@workspace/api-client-react`
hooks and `customFetch` — no mock data. Redesigned the bottom navigation and
order-entry flow in a PhonePe / Paytm style (May 2026).

## Navigation
`app/(owner)/_layout.tsx` and `app/(waiter)/(tabs)/_layout.tsx` use a custom
`AppTabBar` with a raised circular **New Order** gradient button in the
center slot. Owner tabs: **Home · Orders · ➕ · Alerts · More**. All other
modules stay registered as hidden routes (`href: null`) reachable via More.
Kitchen moved off the owner tab bar; still accessible from More and via
quick-action tile / push notification deep links.

## New Order flow
`app/new-order/` is a modal stack pushed by the center button:
1. `index.tsx` — Order Type chooser (Dine-in, Takeaway, Delivery, plus QR /
   Curbside / Pre-order when enabled in restaurant settings).
2. `table.tsx` — Floor-grouped table grid with status legend (dine-in / QR).
3. `customer.tsx` — Name + phone (+ delivery address when type is delivery).
4. `menu.tsx` — Search + category chips + Veg/Non-veg/Bestseller filters,
   `ItemCard` with Add/Customize/stepper, `MobileCartBar` sticky bottom bar,
   `CartSummarySheet` for review (line stepper, per-line note, tax + service
   totals), then **Send to Kitchen** which calls the existing
   `useCreateOrder` + `/orders/{id}/items` endpoints.

`ModifierBottomSheet` fetches `/api/items/:id/modifier-groups` and enforces
required / min / max rules with a live total.

## Restyled surfaces
- **Home** (`(owner)/index.tsx`): warm greeting header, `GradientHeroCard`
  (Sales / Orders / Avg Bill), pulsing "new orders waiting" banner, and a
  `QuickActionTile` grid (Cash, Attendance, Low Stock, Approvals, Fraud,
  Kitchen) with live badges.
- **Orders** (`(owner)/orders.tsx`): status chips (All / New / Preparing /
  Ready / Completed) + type chips (QR / Dine-in / Takeaway / Delivery),
  20s auto-refresh, inline Accept / Reject for new orders, header "+ New"
  button that opens the new-order modal.
- **Cart**: see `CartSummarySheet` + `MobileCartBar`.

## Shared building blocks added this pass
- `components/AppTabBar.tsx` (with `makeAppTabBar`)
- `components/NewOrderCenterButton.tsx` — orange gradient raised button + haptics
- `components/GradientHeroCard.tsx`, `QuickActionTile.tsx`
- `components/OrderTypeSelector.tsx`, `ItemCard.tsx`
- `components/ModifierBottomSheet.tsx`, `CartSummarySheet.tsx`, `MobileCartBar.tsx`
- `context/CartContext.tsx` — extended to track order type / table / customer
  / lines with modifiers + notes (keeps back-compat `addItem` / `setTable`).

## Drift / deferred
- iOS native-tabs (liquid glass) branch removed because the raised center
  button doesn't translate to `NativeTabs`. The custom `AppTabBar` uses
  `BlurView` on iOS to approximate the look.
- Customer / Delivery role tabs unchanged in this pass.
- No end-to-end test run (Expo workflow not started in this environment).
- Modifier API is read-only client-side; group-level "isRequired" is
  inferred from `minSelect` when the field is missing on the legacy item.
