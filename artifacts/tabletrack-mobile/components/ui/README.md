# Mobile Design System

Shared UI primitives for the KhanaLagao mobile app. Every screen should be
built from these — never reach for raw React Native `Text`, `TextInput`,
`Button`, `Switch`, `Modal`, or `Picker`, and never mix icon libraries.

## Tokens — `@/theme`

```ts
import { useTheme } from "@/theme";

const t = useTheme();
t.colors.primary;          // brand color
t.spacing.lg;              // 16
t.radius.lg;               // 16
t.typography.title;        // TextStyle
t.shadow("sm");            // platform-aware shadow / elevation
```

Tokens cover light + dark palettes, an 8-step spacing scale, a 7-step radius
scale, an Inter-based typography scale, and a `shadow(level)` helper that
emits soft drop shadows on iOS and real `elevation` + a hairline border on
Android. The minimum touch target is `t.minTouch` (48 px).

## Primitives

| Component         | When to use                                              |
| ----------------- | -------------------------------------------------------- |
| `AppScreen`       | Root wrapper for every screen — owns SafeArea, status bar, Android nav-bar color, background, keyboard avoidance. |
| `AppHeader`       | Top bar with back button, title/subtitle, right slot.    |
| `AppText`         | All text. Pick a `variant` (`hero` / `title` / `h2` / `h3` / `body` / `bodyMd` / `small` / `micro` / `label`). |
| `AppIcon`         | All icons. Ionicons only.                                |
| `AppCard`         | Surface for grouped content. Radius 16, soft shadow.     |
| `AppButton`       | Tap actions. Variants: `primary` / `secondary` / `outline` / `ghost` / `destructive`. Min height 48. |
| `AppInput`        | Text input with label / helper / error / icons.          |
| `AppSwitch`       | Boolean toggle. Custom — no default Android switch.      |
| `AppDropdown`     | Single-select picker. Opens an `AppBottomSheet` with a searchable list — never the raw Android picker. |
| `AppBottomSheet`  | Slide-up sheet for pickers, large forms, action lists.   |
| `AppModal`        | Small centered dialogs (confirmations).                  |
| `AppBadge`        | Inline status pill. Tones for neutral/info/warning/success/danger/ai/primary. |
| `AppEmptyState`   | "Nothing here yet" zero-state with icon + title + action. |
| `AppSkeleton` / `AppSkeletonList` | Loading placeholders.                    |

## Examples

```tsx
import {
  AppScreen, AppHeader, AppCard, AppText, AppButton,
  AppInput, AppSwitch, AppDropdown, AppBadge,
  AppEmptyState, AppSkeleton, AppBottomSheet, AppModal, AppIcon,
} from "@/components/ui";

<AppScreen scroll padded>
  <AppHeader title="Menu" subtitle="12 items" showBack right={<AppIcon name="add" />} />

  <AppCard>
    <AppText variant="h2">Paneer tikka</AppText>
    <AppText variant="body" color="mutedForeground">Tandoor classics · ₹220</AppText>
    <AppBadge label="Bestseller" tone="warning" />
    <AppButton label="Add to cart" leftIcon="add" fullWidth />
  </AppCard>

  <AppInput label="Customer name" leftIcon="person-outline" placeholder="Aman" />
  <AppDropdown
    label="Floor"
    value={floor}
    options={[{ value: "g", label: "Ground" }, { value: "1", label: "First" }]}
    onChange={setFloor}
  />

  <AppSwitch value={open} onValueChange={setOpen} />

  <AppEmptyState icon="receipt-outline" title="No orders yet" />
  <AppSkeleton width="60%" height={14} />
</AppScreen>
```

## Rules

- **No raw RN primitives** in screens — `Text`, `TextInput`, `Button`,
  `Switch`, `Modal`, `Picker` are disallowed. Extend a primitive instead.
- **One icon library.** All icons go through `AppIcon` (Ionicons). Do not
  import `Feather`, `MaterialCommunityIcons`, etc. directly in screens.
- **No platform-default fonts.** Use `AppText` for all text and
  `t.fontFamily.*` when styling something that can't use `AppText`.
- **No ad-hoc shadows.** Use `t.shadow(level)` so cards look right on
  Android (elevation + soft border) and iOS (soft drop shadow).
- **Min touch target 48 px** on tap targets (`AppButton` enforces this).

## Demo

The throwaway dev-only showcase screen is at `app/__design-system.tsx` and
is only reachable manually (not linked from navigation). Open
`/__design-system` in the dev menu to visually verify the system.
