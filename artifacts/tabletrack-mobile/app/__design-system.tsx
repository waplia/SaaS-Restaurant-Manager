import React, { useState } from "react";
import { View } from "react-native";
import {
  AppScreen,
  AppHeader,
  AppCard,
  AppText,
  AppButton,
  AppInput,
  AppSwitch,
  AppDropdown,
  AppBadge,
  AppEmptyState,
  AppSkeleton,
  AppSkeletonList,
  AppBottomSheet,
  AppModal,
  AppIcon,
  RoleHomeCard,
  QuickActionButton,
  StatusChip,
  SwipeActionRow,
  ConfirmationModal,
  FloatingActionButton,
} from "@/components/ui";
import { useTheme } from "@/theme";

/**
 * Dev-only showcase of every shared primitive. Not linked from navigation
 * — open `/__design-system` manually in the Expo dev menu to verify the
 * system before shipping. Safe to leave in the bundle; it has no side
 * effects.
 */
export default function DesignSystemScreen() {
  const t = useTheme();
  const [text, setText] = useState("");
  const [on, setOn] = useState(true);
  const [floor, setFloor] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <AppScreen scroll>
      <AppHeader title="Design system" subtitle="dev preview" showBack />
      <View style={{ padding: t.spacing.lg, gap: t.spacing.lg }}>
        <Section title="Typography">
          <AppCard>
            <AppText variant="hero">Hero · 28</AppText>
            <AppText variant="title">Title · 22</AppText>
            <AppText variant="h2">H2 · 18</AppText>
            <AppText variant="h3">H3 · 16</AppText>
            <AppText variant="body">Body · 14 regular</AppText>
            <AppText variant="bodyMd">Body Md · 14 medium</AppText>
            <AppText variant="small" color="mutedForeground">Small · 12</AppText>
            <AppText variant="micro" color="mutedForeground">Micro · 11</AppText>
            <AppText variant="label" color="primary">LABEL · 12</AppText>
          </AppCard>
        </Section>

        <Section title="Buttons">
          <AppCard>
            <View style={{ gap: t.spacing.sm }}>
              <AppButton label="Primary" fullWidth leftIcon="add" />
              <AppButton label="Secondary" variant="secondary" fullWidth />
              <AppButton label="Outline" variant="outline" fullWidth />
              <AppButton label="Ghost" variant="ghost" fullWidth />
              <AppButton label="Destructive" variant="destructive" fullWidth leftIcon="trash-outline" />
              <AppButton label="Loading" loading fullWidth />
              <AppButton label="Disabled" disabled fullWidth />
              <View style={{ flexDirection: "row", gap: 8 }}>
                <AppButton label="Sm" size="sm" />
                <AppButton label="Md" size="md" />
                <AppButton label="Lg" size="lg" />
              </View>
            </View>
          </AppCard>
        </Section>

        <Section title="Inputs">
          <AppCard>
            <View style={{ gap: t.spacing.md }}>
              <AppInput label="Name" placeholder="Aman" value={text} onChangeText={setText} leftIcon="person-outline" />
              <AppInput label="Email" placeholder="you@example.com" leftIcon="mail-outline" helperText="We'll never share this." />
              <AppInput label="Password" placeholder="••••••••" leftIcon="lock-closed-outline" rightIcon="eye-outline" secureTextEntry />
              <AppInput label="Coupon" error="Invalid code" defaultValue="ABCD" />
              <AppDropdown
                label="Floor"
                value={floor}
                onChange={setFloor}
                placeholder="Pick a floor"
                options={[
                  { value: "g", label: "Ground floor", description: "8 tables" },
                  { value: "1", label: "First floor", description: "12 tables" },
                  { value: "2", label: "Rooftop", description: "6 tables" },
                ]}
              />
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <AppText variant="bodyMd">Accept new orders</AppText>
                <AppSwitch value={on} onValueChange={setOn} />
              </View>
            </View>
          </AppCard>
        </Section>

        <Section title="Badges">
          <AppCard>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              <AppBadge label="Neutral" />
              <AppBadge label="Primary" tone="primary" />
              <AppBadge label="Info" tone="info" />
              <AppBadge label="Warning" tone="warning" />
              <AppBadge label="Success" tone="success" />
              <AppBadge label="Danger" tone="danger" />
              <AppBadge label="AI" tone="ai" />
              <AppBadge label="Solid" tone="primary" variant="solid" />
              <AppBadge label="Outline" tone="info" variant="outline" />
            </View>
          </AppCard>
        </Section>

        <Section title="Icons">
          <AppCard>
            <View style={{ flexDirection: "row", gap: 16, flexWrap: "wrap" }}>
              <AppIcon name="home-outline" />
              <AppIcon name="restaurant-outline" color="primary" />
              <AppIcon name="notifications-outline" color="warning" />
              <AppIcon name="checkmark-circle" color="success" />
              <AppIcon name="alert-circle" color="destructive" />
            </View>
          </AppCard>
        </Section>

        <Section title="Sheets & modals">
          <AppCard>
            <View style={{ gap: 8 }}>
              <AppButton label="Open bottom sheet" onPress={() => setSheetOpen(true)} fullWidth variant="outline" />
              <AppButton label="Open modal" onPress={() => setModalOpen(true)} fullWidth variant="outline" />
            </View>
          </AppCard>
        </Section>

        <Section title="Empty state">
          <AppCard padding={0}>
            <AppEmptyState
              icon="receipt-outline"
              title="No orders yet"
              description="New orders will show up here as soon as a customer places one."
              actionLabel="Take order"
              onAction={() => {}}
            />
          </AppCard>
        </Section>

        <Section title="Skeletons">
          <AppCard padding={0}>
            <AppSkeletonList rows={3} />
          </AppCard>
        </Section>

        <Section title="Role home cards">
          <View style={{ gap: t.spacing.sm }}>
            <RoleHomeCard
              eyebrow="Today"
              icon="cash-outline"
              title="Tickets to bill"
              value="4"
              subtitle="Served orders waiting for the cashier."
              badge={{ label: "4", tone: "primary" }}
              onPress={() => {}}
            />
            <RoleHomeCard
              eyebrow="Action needed"
              icon="cube-outline"
              title="Low-stock items"
              value="12"
              subtitle="Items at or below their reorder level."
              badge={{ label: "12", tone: "warning" }}
              onPress={() => {}}
            />
          </View>
        </Section>

        <Section title="Quick actions">
          <AppCard>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <QuickActionButton icon="receipt-outline" label="New order" onPress={() => {}} />
              <QuickActionButton icon="flame-outline" label="Kitchen" onPress={() => {}} />
              <QuickActionButton icon="cube-outline" label="Stock" onPress={() => {}} />
              <QuickActionButton icon="megaphone-outline" label="Campaign" onPress={() => {}} />
              <QuickActionButton icon="lock-closed-outline" label="Close shift" onPress={() => {}} disabled />
            </View>
          </AppCard>
        </Section>

        <Section title="Status chips">
          <AppCard>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              <StatusChip label="Pending" tone="warning" />
              <StatusChip label="Preparing" tone="info" />
              <StatusChip label="Ready" tone="primary" />
              <StatusChip label="Served" tone="success" />
              <StatusChip label="Cancelled" tone="danger" />
              <StatusChip label="Draft" tone="neutral" />
            </View>
          </AppCard>
        </Section>

        <Section title="Swipe action row">
          <AppCard padding={0}>
            <SwipeActionRow
              rightAction={{ label: "Delete", icon: "trash-outline", onPress: () => {} }}
              leftAction={{ label: "Archive", icon: "archive-outline", onPress: () => {} }}
            >
              <View style={{ padding: 14 }}>
                <AppText variant="bodyMd" weight="semibold">Table 12 — Order #1042</AppText>
                <AppText variant="small" color="mutedForeground">Swipe left to reveal actions</AppText>
              </View>
            </SwipeActionRow>
          </AppCard>
        </Section>

        <Section title="Confirmation modal">
          <AppCard>
            <AppButton
              label="Open confirmation"
              variant="outline"
              fullWidth
              onPress={() => setConfirmOpen(true)}
            />
          </AppCard>
        </Section>

        <Section title="Floating action button">
          <AppCard padding={0}>
            <View style={{ height: 120 }}>
              <FloatingActionButton
                icon="add"
                label="New order"
                onPress={() => {}}
                placement="right"
                bottomOffset={16}
              />
            </View>
          </AppCard>
        </Section>
      </View>

      <AppBottomSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} title="Bottom sheet">
        <AppText variant="body" color="mutedForeground">
          This is an AppBottomSheet. Use it for pickers, action lists, and large
          forms instead of the raw Android Modal/Picker.
        </AppText>
        <AppButton label="Dismiss" fullWidth onPress={() => setSheetOpen(false)} />
      </AppBottomSheet>

      <ConfirmationModal
        visible={confirmOpen}
        title="Delete this draft?"
        message="The order draft and all unsynced items will be removed. This can't be undone."
        confirmLabel="Delete"
        tone="destructive"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => setConfirmOpen(false)}
      />

      <AppModal visible={modalOpen} onClose={() => setModalOpen(false)} title="Are you sure?">
        <AppText variant="body" color="mutedForeground">
          This is an AppModal — use it for confirmations and small focused dialogs.
        </AppText>
        <View style={{ flexDirection: "row", gap: 8, marginTop: 16 }}>
          <AppButton label="Cancel" variant="ghost" onPress={() => setModalOpen(false)} fullWidth style={{ flex: 1 }} />
          <AppButton label="Delete" variant="destructive" onPress={() => setModalOpen(false)} fullWidth style={{ flex: 1 }} />
        </View>
      </AppModal>
    </AppScreen>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <AppText variant="label" color="mutedForeground">{title.toUpperCase()}</AppText>
      {children}
    </View>
  );
}
