import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator,
  KeyboardAvoidingView, Platform, ScrollView, Alert,
} from "react-native";
import { router, Stack } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { getApiBaseUrl } from "@/lib/apiBaseUrl";
import { PhoneInput } from "@/components/PhoneInput";
import { roleHomePath } from "@/lib/roles";

type StepId =
  | "profile" | "branch" | "kitchen" | "menu_categories" | "menu_items"
  | "tables" | "staff" | "payment" | "go_live";

interface StepDef { id: StepId; title: string; desc: string; skippable?: boolean }

const STEPS: StepDef[] = [
  { id: "profile", title: "Restaurant profile", desc: "Phone, address, currency" },
  { id: "branch", title: "Add a branch", desc: "Skip if you only have one location", skippable: true },
  { id: "kitchen", title: "Set up a kitchen", desc: "Where orders will be routed" },
  { id: "menu_categories", title: "Menu categories", desc: "Group your dishes" },
  { id: "menu_items", title: "Menu items", desc: "Add at least one dish" },
  { id: "tables", title: "Add tables", desc: "Bulk-add seating" },
  { id: "staff", title: "Invite staff", desc: "Optional", skippable: true },
  { id: "payment", title: "Payment & tax", desc: "Optional — set tax rate", skippable: true },
  { id: "go_live", title: "Go live", desc: "Review and launch" },
];

interface OnboardingState {
  isOnboarded: boolean;
  completedAt: string | null;
  skippedSteps: string[];
  defaultMenuId: number;
  counts: { branches: number; kitchens: number; categories: number; items: number; tables: number; staff: number };
  steps: { id: StepId; completed: boolean; skipped: boolean; skippable: boolean }[];
}

function useApiHelpers() {
  const { accessToken } = useAuth();
  const base = `${getApiBaseUrl()}/api`;
  async function call<T>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = new Error((data as { error?: string }).error ?? `Request failed (${r.status})`);
      (err as { status?: number }).status = r.status;
      throw err;
    }
    return data as T;
  }
  return {
    get: <T,>(path: string) => call<T>("GET", path),
    post: <T,>(path: string, body?: unknown) => call<T>("POST", path, body),
    patch: <T,>(path: string, body?: unknown) => call<T>("PATCH", path, body),
  };
}

export default function OnboardingScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const api = useApiHelpers();

  const [state, setState] = useState<OnboardingState | null>(null);
  const [loadingState, setLoadingState] = useState(true);
  const [activeIdx, setActiveIdx] = useState(0);
  const [view, setView] = useState<"wizard" | "checklist">("wizard");
  const resumedRef = useRef(false);

  // Owners/managers only; everyone else goes straight to their dashboard.
  const isOwnerRole = user?.role === "owner" || user?.role === "manager" || user?.isSuperAdmin;

  async function refreshState() {
    try {
      const s = await api.get<OnboardingState>("/onboarding/state");
      setState(s);
      if (!resumedRef.current) {
        resumedRef.current = true;
        const idx = STEPS.findIndex(def => {
          const st = s.steps.find(x => x.id === def.id);
          return !st || (!st.completed && !st.skipped);
        });
        if (idx > 0) setActiveIdx(idx);
      }
    } catch (e) {
      // Non-owner roles get 403 from the endpoint; bounce them to their role
      // dashboard immediately so they don't sit on a permanent loader.
      if (!isOwnerRole) {
        router.replace(roleHomePath(user?.role) as Parameters<typeof router.replace>[0]);
        return;
      }
      Alert.alert("Could not load setup", e instanceof Error ? e.message : "Try again");
    } finally {
      setLoadingState(false);
    }
  }

  useEffect(() => {
    if (!user) {
      router.replace("/welcome");
      return;
    }
    if (!isOwnerRole) {
      router.replace(roleHomePath(user.role) as Parameters<typeof router.replace>[0]);
      return;
    }
    void refreshState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const stepStatus = useMemo(() => {
    const m = new Map<StepId, { completed: boolean; skipped: boolean }>();
    state?.steps.forEach(s => m.set(s.id, { completed: s.completed, skipped: s.skipped }));
    return m;
  }, [state]);

  const completedCount = state ? state.steps.filter(s => s.completed).length : 0;
  const totalSteps = STEPS.length;
  const progressPct = Math.round((completedCount / totalSteps) * 100);

  async function skipStep(step: StepId) {
    try {
      await api.patch("/onboarding/state", { skip: step });
      await refreshState();
    } catch (e) {
      Alert.alert("Couldn't skip", e instanceof Error ? e.message : "Try again");
    }
  }

  async function completeOnboarding() {
    try {
      await api.patch("/onboarding/state", { complete: true });
      router.replace(roleHomePath(user?.role) as Parameters<typeof router.replace>[0]);
    } catch (e) {
      Alert.alert("Not yet", e instanceof Error ? e.message : "Finish the required steps first.");
    }
  }

  if (loadingState || !state) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const activeStep = STEPS[activeIdx];
  const restaurantId = user?.restaurantId ?? 0;
  const headerPad = insets.top + 8;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: colors.background }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={[styles.header, { paddingTop: headerPad, borderBottomColor: colors.border }]}>
          <Pressable hitSlop={12} onPress={() => setView(v => v === "wizard" ? "checklist" : "wizard")}>
            <Ionicons name={view === "wizard" ? "list-outline" : "arrow-back"} size={22} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>
            {view === "wizard" ? `Setup · Step ${activeIdx + 1} of ${totalSteps}` : "Setup checklist"}
          </Text>
          <Pressable onPress={() => router.replace(roleHomePath(user?.role) as Parameters<typeof router.replace>[0])} hitSlop={12}>
            <Text style={{ color: colors.primary, fontSize: 13, fontFamily: "Inter_500Medium" }}>Continue later</Text>
          </Pressable>
        </View>

        <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
          <View style={[styles.progressBar, { backgroundColor: colors.muted }]}>
            <View style={[styles.progressFill, { width: `${progressPct}%`, backgroundColor: colors.primary }]} />
          </View>
          <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 6 }}>
            {completedCount} of {totalSteps} complete · {progressPct}%
          </Text>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }} keyboardShouldPersistTaps="handled">
          {view === "checklist" ? (
            <ChecklistView state={state} onPickStep={(i) => { setActiveIdx(i); setView("wizard"); }} colors={colors} />
          ) : (
            <>
              <View style={{ marginBottom: 16 }}>
                <Text style={[styles.stepTitle, { color: colors.foreground }]}>{activeStep.title}</Text>
                <Text style={{ color: colors.mutedForeground, fontSize: 14, marginTop: 4 }}>{activeStep.desc}</Text>
              </View>

              <StepView
                step={activeStep.id}
                restaurantId={restaurantId}
                defaultMenuId={state.defaultMenuId}
                api={api}
                onChanged={refreshState}
                onAdvance={() => setActiveIdx(i => Math.min(i + 1, STEPS.length - 1))}
                onComplete={completeOnboarding}
                state={state}
                colors={colors}
              />

              <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 24, gap: 8 }}>
                <Pressable
                  onPress={() => setActiveIdx(i => Math.max(0, i - 1))}
                  disabled={activeIdx === 0}
                  style={({ pressed }) => [styles.ghostBtn, { borderColor: colors.border, opacity: activeIdx === 0 ? 0.4 : pressed ? 0.7 : 1 }]}
                >
                  <Ionicons name="chevron-back" size={16} color={colors.foreground} />
                  <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: "Inter_500Medium" }}>Back</Text>
                </Pressable>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {activeStep.skippable && !stepStatus.get(activeStep.id)?.completed && (
                    <Pressable
                      onPress={() => skipStep(activeStep.id)}
                      style={({ pressed }) => [styles.ghostBtn, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
                    >
                      <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>Skip</Text>
                    </Pressable>
                  )}
                  {activeIdx < STEPS.length - 1 && (
                    <Pressable
                      onPress={() => {
                        const st = stepStatus.get(activeStep.id);
                        if (!st?.completed && !st?.skipped && activeStep.skippable) {
                          void skipStep(activeStep.id).then(() => setActiveIdx(i => Math.min(i + 1, STEPS.length - 1)));
                        } else {
                          setActiveIdx(i => Math.min(i + 1, STEPS.length - 1));
                        }
                      }}
                      disabled={(() => {
                        const st = stepStatus.get(activeStep.id);
                        return !st?.completed && !st?.skipped && !activeStep.skippable;
                      })()}
                      style={({ pressed }) => {
                        const st = stepStatus.get(activeStep.id);
                        const disabled = !st?.completed && !st?.skipped && !activeStep.skippable;
                        return [styles.primaryBtn, {
                          backgroundColor: colors.primary,
                          opacity: disabled ? 0.4 : pressed ? 0.85 : 1,
                          paddingHorizontal: 18,
                        }];
                      }}
                    >
                      <Text style={styles.primaryBtnText}>Next</Text>
                      <Ionicons name="chevron-forward" size={16} color="#fff" />
                    </Pressable>
                  )}
                </View>
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

function ChecklistView({
  state, onPickStep, colors,
}: {
  state: OnboardingState;
  onPickStep: (idx: number) => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={{ gap: 8 }}>
      {STEPS.map((def, i) => {
        const st = state.steps.find(s => s.id === def.id);
        const done = !!st?.completed;
        const skipped = !!st?.skipped;
        return (
          <Pressable
            key={def.id}
            onPress={() => onPickStep(i)}
            style={({ pressed }) => [styles.checklistRow, {
              backgroundColor: colors.card, borderColor: colors.border,
              opacity: pressed ? 0.85 : 1,
            }]}
          >
            <View style={[styles.checklistBadge, {
              backgroundColor: done ? "#10b981" : skipped ? colors.muted : colors.primary + "22",
            }]}>
              {done ? <Ionicons name="checkmark" size={16} color="#fff" /> :
                skipped ? <Ionicons name="play-skip-forward" size={14} color={colors.mutedForeground} /> :
                <Text style={{ color: colors.primary, fontSize: 13, fontFamily: "Inter_600SemiBold" }}>{i + 1}</Text>}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.foreground, fontSize: 15, fontFamily: "Inter_600SemiBold",
                textDecorationLine: skipped ? "line-through" : "none" }}>
                {def.title}
              </Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 2 }}>
                {skipped ? "Skipped" : def.desc}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
          </Pressable>
        );
      })}
    </View>
  );
}

// ───── per-step content ─────────────────────────────────────────

interface ApiHelpers {
  get: <T>(path: string) => Promise<T>;
  post: <T>(path: string, body?: unknown) => Promise<T>;
  patch: <T>(path: string, body?: unknown) => Promise<T>;
}

interface StepProps {
  step: StepId;
  restaurantId: number;
  defaultMenuId: number;
  api: ApiHelpers;
  onChanged: () => Promise<void> | void;
  onAdvance: () => void;
  onComplete: () => void;
  state: OnboardingState;
  colors: ReturnType<typeof useColors>;
}

function StepView(p: StepProps) {
  switch (p.step) {
    case "profile": return <ProfileStep {...p} />;
    case "branch": return <BranchStep {...p} />;
    case "kitchen": return <KitchenStep {...p} />;
    case "menu_categories": return <CategoriesStep {...p} />;
    case "menu_items": return <ItemsStep {...p} />;
    case "tables": return <TablesStep {...p} />;
    case "staff": return <StaffStep {...p} />;
    case "payment": return <PaymentStep {...p} />;
    case "go_live": return <GoLiveStep {...p} />;
  }
}

function ProfileStep({ restaurantId, api, onChanged, onAdvance, colors }: StepProps) {
  const [form, setForm] = useState({ name: "", phone: "", address: "", city: "", currency: "INR" });
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const r = await api.get<{ name: string; phone: string | null; address: string | null; city: string | null; currency: string | null }>(`/restaurants/${restaurantId}`);
        setForm({
          name: r.name ?? "", phone: r.phone ?? "", address: r.address ?? "",
          city: r.city ?? "", currency: r.currency ?? "INR",
        });
      } catch { /* leave defaults */ }
      finally { setLoaded(true); }
    })();
  }, [restaurantId, api]);

  async function save() {
    if (!form.name.trim() || !form.phone.trim() || !form.address.trim() || !form.city.trim()) {
      Alert.alert("Required", "Fill in name, phone, address and city.");
      return;
    }
    setBusy(true);
    try {
      await api.patch(`/restaurants/${restaurantId}`, form);
      await onChanged();
      onAdvance();
    } catch (e) {
      Alert.alert("Save failed", e instanceof Error ? e.message : "Try again");
    } finally { setBusy(false); }
  }

  if (!loaded) return <ActivityIndicator color={colors.primary} />;

  return (
    <View style={{ gap: 12 }}>
      <FormField label="Restaurant name" colors={colors}>
        <BasicInput value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} placeholder="Spice Garden" colors={colors} />
      </FormField>
      <FormField label="Phone" colors={colors}>
        <PhoneInput value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} defaultCountry="IN" placeholder="9876543210" />
      </FormField>
      <FormField label="Address" colors={colors}>
        <BasicInput value={form.address} onChangeText={(v) => setForm({ ...form, address: v })} placeholder="MG Road, near City Mall" colors={colors} />
      </FormField>
      <FormField label="City" colors={colors}>
        <BasicInput value={form.city} onChangeText={(v) => setForm({ ...form, city: v })} placeholder="Bengaluru" colors={colors} />
      </FormField>
      <Pressable
        onPress={save} disabled={busy}
        style={({ pressed }) => [styles.primaryBtn, { backgroundColor: colors.primary, opacity: pressed || busy ? 0.85 : 1, alignSelf: "flex-start", paddingHorizontal: 22 }]}
      >
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Save profile</Text>}
      </Pressable>
    </View>
  );
}

function BranchStep({ restaurantId, api, onChanged, colors }: StepProps) {
  const [branches, setBranches] = useState<{ id: number; name: string; address: string | null }[]>([]);
  const [form, setForm] = useState({ name: "", address: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.get<typeof branches>(`/restaurants/${restaurantId}/branches`).then(setBranches).catch(() => {});
  }, [restaurantId, api]);

  async function add() {
    if (!form.name.trim()) return;
    setBusy(true);
    try {
      await api.post(`/restaurants/${restaurantId}/branches`, form);
      setForm({ name: "", address: "" });
      const fresh = await api.get<typeof branches>(`/restaurants/${restaurantId}/branches`);
      setBranches(fresh);
      await onChanged();
    } catch (e) {
      Alert.alert("Couldn't add branch", e instanceof Error ? e.message : "Try again");
    } finally { setBusy(false); }
  }

  return (
    <View style={{ gap: 12 }}>
      <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
        Your <Text style={{ fontFamily: "Inter_600SemiBold", color: colors.foreground }}>Main</Text> branch is already created. Skip this step if you only run one location.
      </Text>
      {branches.map(b => (
        <View key={b.id} style={[styles.listRow, { backgroundColor: colors.muted }]}>
          <Ionicons name="checkmark-circle" size={18} color="#10b981" />
          <Text style={{ color: colors.foreground, fontFamily: "Inter_500Medium", flex: 1 }}>{b.name}</Text>
        </View>
      ))}
      <FormField label="Branch name" colors={colors}>
        <BasicInput value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} placeholder="Indiranagar branch" colors={colors} />
      </FormField>
      <FormField label="Address" colors={colors}>
        <BasicInput value={form.address} onChangeText={(v) => setForm({ ...form, address: v })} placeholder="100 Ft Road" colors={colors} />
      </FormField>
      <Pressable onPress={add} disabled={busy || !form.name.trim()}
        style={({ pressed }) => [styles.primaryBtn, { backgroundColor: colors.primary, opacity: busy || !form.name.trim() ? 0.5 : pressed ? 0.85 : 1, alignSelf: "flex-start", paddingHorizontal: 22 }]}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Add branch</Text>}
      </Pressable>
    </View>
  );
}

function KitchenStep({ restaurantId, api, onChanged, onAdvance, colors }: StepProps) {
  const [kitchens, setKitchens] = useState<{ id: number; name: string; isDefault?: boolean }[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function reload() {
    try { setKitchens(await api.get(`/restaurants/${restaurantId}/kitchens`)); } catch {}
  }
  useEffect(() => { void reload(); }, [restaurantId]);

  async function add() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api.post(`/restaurants/${restaurantId}/kitchens`, { name: name.trim() });
      setName("");
      await reload();
      await onChanged();
    } catch (e) {
      Alert.alert("Couldn't add", e instanceof Error ? e.message : "Try again");
    } finally { setBusy(false); }
  }

  return (
    <View style={{ gap: 12 }}>
      <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
        Kitchens route orders for prep. Most restaurants start with one (e.g. "Main Kitchen"). Add a bar or tandoor later.
      </Text>
      {kitchens.map(k => (
        <View key={k.id} style={[styles.listRow, { backgroundColor: colors.muted }]}>
          <Ionicons name="checkmark-circle" size={18} color="#10b981" />
          <Text style={{ color: colors.foreground, fontFamily: "Inter_500Medium", flex: 1 }}>{k.name}</Text>
          {k.isDefault && <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>default</Text>}
        </View>
      ))}
      <FormField label="New kitchen" colors={colors}>
        <BasicInput value={name} onChangeText={setName} placeholder="Main Kitchen" colors={colors} />
      </FormField>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Pressable onPress={add} disabled={busy || !name.trim()}
          style={({ pressed }) => [styles.primaryBtn, { backgroundColor: colors.primary, opacity: busy || !name.trim() ? 0.5 : pressed ? 0.85 : 1, paddingHorizontal: 22 }]}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Add kitchen</Text>}
        </Pressable>
        {kitchens.length > 0 && (
          <Pressable onPress={onAdvance} style={({ pressed }) => [styles.ghostBtn, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}>
            <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: "Inter_500Medium" }}>Continue</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function CategoriesStep({ restaurantId, defaultMenuId, api, onChanged, onAdvance, colors }: StepProps) {
  const [cats, setCats] = useState<{ id: number; name: string }[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function reload() {
    try { setCats(await api.get(`/restaurants/${restaurantId}/categories?menuId=${defaultMenuId}`)); } catch {}
  }
  useEffect(() => { void reload(); }, [restaurantId, defaultMenuId]);

  async function add() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api.post(`/restaurants/${restaurantId}/categories`, { menuId: defaultMenuId, name: name.trim() });
      setName("");
      await reload();
      await onChanged();
    } catch (e) {
      Alert.alert("Couldn't add", e instanceof Error ? e.message : "Try again");
    } finally { setBusy(false); }
  }

  return (
    <View style={{ gap: 12 }}>
      <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>Group your dishes into categories like Starters, Mains, Drinks.</Text>
      {cats.map(c => (
        <View key={c.id} style={[styles.listRow, { backgroundColor: colors.muted }]}>
          <Ionicons name="checkmark-circle" size={18} color="#10b981" />
          <Text style={{ color: colors.foreground, fontFamily: "Inter_500Medium", flex: 1 }}>{c.name}</Text>
        </View>
      ))}
      <FormField label="Category name" colors={colors}>
        <BasicInput value={name} onChangeText={setName} placeholder="Starters" colors={colors} />
      </FormField>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Pressable onPress={add} disabled={busy || !name.trim()}
          style={({ pressed }) => [styles.primaryBtn, { backgroundColor: colors.primary, opacity: busy || !name.trim() ? 0.5 : pressed ? 0.85 : 1, paddingHorizontal: 22 }]}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Add</Text>}
        </Pressable>
        {cats.length > 0 && (
          <Pressable onPress={onAdvance} style={({ pressed }) => [styles.ghostBtn, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}>
            <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: "Inter_500Medium" }}>Continue</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function ItemsStep({ restaurantId, api, onChanged, onAdvance, colors }: StepProps) {
  const [cats, setCats] = useState<{ id: number; name: string }[]>([]);
  const [kitchens, setKitchens] = useState<{ id: number; name: string; isDefault?: boolean }[]>([]);
  const [items, setItems] = useState<{ id: number; name: string; price: string }[]>([]);
  const [form, setForm] = useState({ categoryId: 0, kitchenId: 0, name: "", price: "", isVeg: true });
  const [busy, setBusy] = useState(false);

  async function reloadItems() {
    try {
      const fresh = await api.get<{ id: number; name: string; price: string }[]>(`/restaurants/${restaurantId}/items`);
      setItems(fresh);
    } catch { /* ignore */ }
  }

  useEffect(() => {
    void (async () => {
      try {
        const [c, k, i] = await Promise.all([
          api.get<{ id: number; name: string }[]>(`/restaurants/${restaurantId}/categories`),
          api.get<{ id: number; name: string; isDefault?: boolean }[]>(`/restaurants/${restaurantId}/kitchens`),
          api.get<{ id: number; name: string; price: string }[]>(`/restaurants/${restaurantId}/items`),
        ]);
        setCats(c); setKitchens(k); setItems(i);
        const defKitchen = k.find(x => x.isDefault) ?? k[0];
        setForm(f => ({
          ...f,
          categoryId: c[0]?.id ?? 0,
          kitchenId: defKitchen?.id ?? 0,
        }));
      } catch {}
    })();
  }, [restaurantId]);

  async function add() {
    if (!form.categoryId || !form.kitchenId || !form.name.trim() || !form.price) {
      Alert.alert("Required", "Pick a category, kitchen, name and price.");
      return;
    }
    setBusy(true);
    try {
      await api.post(`/restaurants/${restaurantId}/items`, {
        categoryId: form.categoryId,
        kitchenId: form.kitchenId,
        name: form.name.trim(),
        price: form.price,
        isVeg: form.isVeg,
      });
      const fresh = await api.get<typeof items>(`/restaurants/${restaurantId}/items`);
      setItems(fresh);
      setForm({ ...form, name: "", price: "" });
      await onChanged();
    } catch (e) {
      Alert.alert("Couldn't add", e instanceof Error ? e.message : "Try again");
    } finally { setBusy(false); }
  }

  if (cats.length === 0) {
    return (
      <View style={{ padding: 14, borderRadius: 10, backgroundColor: "#fef3c7", borderWidth: 1, borderColor: "#fcd34d" }}>
        <Text style={{ color: "#92400e", fontSize: 13 }}>Add at least one category in the previous step before adding menu items.</Text>
      </View>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      {items.slice(0, 5).map(it => (
        <View key={it.id} style={[styles.listRow, { backgroundColor: colors.muted }]}>
          <Ionicons name="checkmark-circle" size={18} color="#10b981" />
          <Text style={{ color: colors.foreground, fontFamily: "Inter_500Medium", flex: 1 }}>{it.name}</Text>
          <Text style={{ color: colors.mutedForeground }}>₹{it.price}</Text>
        </View>
      ))}

      <MenuImportPanel
        restaurantId={restaurantId}
        api={api}
        colors={colors}
        onSaved={async () => { await reloadItems(); await onChanged(); }}
      />

      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 }}>
        <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
        <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>or add manually</Text>
        <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
      </View>

      <FormField label="Category" colors={colors}>
        <ChoiceRow
          options={cats.map(c => ({ id: c.id, label: c.name }))}
          selected={form.categoryId}
          onSelect={(id) => setForm({ ...form, categoryId: id as number })}
          colors={colors}
        />
      </FormField>
      <FormField label="Kitchen" colors={colors}>
        <ChoiceRow
          options={kitchens.map(k => ({ id: k.id, label: k.name }))}
          selected={form.kitchenId}
          onSelect={(id) => setForm({ ...form, kitchenId: id as number })}
          colors={colors}
        />
      </FormField>
      <FormField label="Type" colors={colors}>
        <ChoiceRow
          options={[{ id: "veg", label: "Veg" }, { id: "nonveg", label: "Non-veg" }]}
          selected={form.isVeg ? "veg" : "nonveg"}
          onSelect={(id) => setForm({ ...form, isVeg: id === "veg" })}
          colors={colors}
        />
      </FormField>
      <FormField label="Item name" colors={colors}>
        <BasicInput value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} placeholder="Paneer Tikka" colors={colors} />
      </FormField>
      <FormField label="Price (₹)" colors={colors}>
        <BasicInput value={form.price} onChangeText={(v) => setForm({ ...form, price: v })} placeholder="280" keyboardType="number-pad" colors={colors} />
      </FormField>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Pressable onPress={add} disabled={busy}
          style={({ pressed }) => [styles.primaryBtn, { backgroundColor: colors.primary, opacity: busy ? 0.5 : pressed ? 0.85 : 1, paddingHorizontal: 22 }]}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Add item</Text>}
        </Pressable>
        {items.length > 0 && (
          <Pressable onPress={onAdvance} style={({ pressed }) => [styles.ghostBtn, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}>
            <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: "Inter_500Medium" }}>Continue</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

// ───── AI Menu Import panel (used inside ItemsStep) ──────────────
// Mirrors the web /ai/menu-import flow: pick a source (photo / PDF / URL /
// text), kick off the AI extraction job, poll until ready, then auto-save
// every row the AI didn't flag for review or duplicate. Photo + PDF both use
// the presigned-URL storage flow (server caps uploads at 10 MB and allows
// image/* + application/pdf only — see api-server/src/routes/storage.ts).
// CSV / Excel are web-only because the storage backend rejects those
// content types; users can run those on the web dashboard.

type ImportSource = "image" | "pdf" | "url" | "text";
const STORAGE_MAX_BYTES = 10 * 1024 * 1024; // matches assertAllowedContentType cap

interface ImportItemRow {
  id: number;
  status: "draft" | "saved" | "skipped" | "error" | "rolled_back";
  needsReview: boolean;
  duplicateMatchId: number | null;
  structured: { name: string; price?: number | string | null; categoryName?: string | null };
}
interface ImportDetail {
  import: {
    id: number;
    status: "pending" | "processing" | "ready" | "partially_saved" | "saved" | "failed" | "rolled_back";
    errorMessage: string | null;
    totalRows: number;
    needsReviewCount: number;
    savedItemCount: number;
  };
  items: ImportItemRow[];
}

interface MenuImportPanelProps {
  restaurantId: number;
  api: ApiHelpers;
  colors: ReturnType<typeof useColors>;
  onSaved: () => Promise<void> | void;
}

function MenuImportPanel({ restaurantId, api, colors, onSaved }: MenuImportPanelProps) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<ImportSource>("image");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<{ uri: string; name: string; mime: string; size: number } | null>(null);
  const [importId, setImportId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ImportDetail | null>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "starting" | "processing" | "saving" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelledRef.current = true;
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, []);

  function reset() {
    cancelledRef.current = true;
    if (pollRef.current) clearTimeout(pollRef.current);
    pollRef.current = null;
    setImportId(null); setDetail(null); setStatus("idle");
    setError(null); setUrl(""); setText(""); setPicked(null);
  }

  // Run an async update only if the panel is still mounted and the current
  // import hasn't been cancelled by reset/close.
  const safe = <T,>(fn: (v: T) => void) => (v: T) => {
    if (!cancelledRef.current && mountedRef.current) fn(v);
  };

  async function pickPhoto() {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permission needed", "Allow photo access to attach a menu photo.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.85,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const a = result.assets[0];
      const blob = await (await fetch(a.uri)).blob();
      if (blob.size > STORAGE_MAX_BYTES) {
        Alert.alert("Photo too large", `Max 10 MB. Try a smaller or compressed photo.`);
        return;
      }
      setPicked({
        uri: a.uri,
        name: a.fileName ?? `menu-${Date.now()}.jpg`,
        mime: a.mimeType ?? "image/jpeg",
        size: blob.size,
      });
    } catch (e) {
      Alert.alert("Could not pick photo", e instanceof Error ? e.message : "Try again.");
    }
  }

  async function pickPdf() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "application/pdf",
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const a = result.assets[0];
      const size = a.size ?? (await (await fetch(a.uri)).blob()).size;
      if (size > STORAGE_MAX_BYTES) {
        Alert.alert("PDF too large", "Max 10 MB. Try splitting the file or exporting fewer pages.");
        return;
      }
      setPicked({
        uri: a.uri,
        name: a.name || `menu-${Date.now()}.pdf`,
        mime: a.mimeType || "application/pdf",
        size,
      });
    } catch (e) {
      Alert.alert("Could not pick PDF", e instanceof Error ? e.message : "Try again.");
    }
  }

  async function uploadPickedFile(): Promise<string> {
    if (!picked) throw new Error("No file picked");
    const presign = await api.post<{ uploadURL: string; objectPath: string }>(
      `/restaurants/${restaurantId}/storage/uploads/request-url`,
      { name: picked.name, size: picked.size, contentType: picked.mime },
    );
    const blob = await (await fetch(picked.uri)).blob();
    const put = await fetch(presign.uploadURL, {
      method: "PUT",
      headers: { "Content-Type": picked.mime },
      body: blob,
    });
    if (!put.ok) throw new Error(`Upload failed (${put.status})`);
    await api.post(`/restaurants/${restaurantId}/storage/uploads/finalize`, { objectPath: presign.objectPath });
    return presign.objectPath;
  }

  async function pollDetail(id: number) {
    try {
      const d = await api.get<ImportDetail>(`/restaurants/${restaurantId}/ai/menu-import/imports/${id}`);
      if (cancelledRef.current || !mountedRef.current) return;
      safe(setDetail)(d);
      const s = d.import.status;
      if (s === "pending" || s === "processing") {
        safe(setStatus)("processing");
        pollRef.current = setTimeout(() => {
          if (!cancelledRef.current && mountedRef.current) void pollDetail(id);
        }, 2500);
        return;
      }
      if (s === "failed") {
        safe(setStatus)("error");
        safe(setError)(d.import.errorMessage ?? "Import failed.");
        return;
      }
      // Ready (or partially_saved) → auto-save rows the AI is confident in.
      await autoSave(d);
    } catch (e) {
      if (cancelledRef.current || !mountedRef.current) return;
      safe(setStatus)("error");
      safe(setError)(e instanceof Error ? e.message : "Could not load import.");
    }
  }

  async function autoSave(d: ImportDetail) {
    const rowIds = d.items
      .filter(r => r.status === "draft" && !r.needsReview && !r.duplicateMatchId)
      .map(r => r.id);
    if (rowIds.length === 0) {
      safe(setStatus)("done");
      safe(setError)(d.import.totalRows === 0
        ? "AI couldn't find any items. Try a clearer photo or paste the text."
        : `All ${d.import.totalRows} extracted item${d.import.totalRows === 1 ? "" : "s"} need review on the web dashboard before saving.`);
      return;
    }
    safe(setStatus)("saving");
    try {
      const res = await api.post<{ savedCount: number; errors: { rowId: number; error: string }[] }>(
        `/restaurants/${restaurantId}/ai/menu-import/imports/${d.import.id}/save`,
        { rowIds },
      );
      if (cancelledRef.current || !mountedRef.current) {
        // Panel was closed mid-save; still refresh items so the user sees them.
        await onSaved();
        return;
      }
      safe(setStatus)("done");
      const flagged = d.import.totalRows - rowIds.length;
      const msg =
        `Imported ${res.savedCount} item${res.savedCount === 1 ? "" : "s"}` +
        (flagged > 0 ? ` · ${flagged} need review on the web dashboard` : "") +
        (res.errors.length > 0 ? ` · ${res.errors.length} failed` : "");
      safe(setError)(msg);
      await onSaved();
    } catch (e) {
      if (cancelledRef.current || !mountedRef.current) return;
      safe(setStatus)("error");
      safe(setError)(e instanceof Error ? e.message : "Save failed.");
    }
  }

  async function start() {
    // Re-enable safe state updates for this run (reset() flips this true).
    cancelledRef.current = false;
    setError(null);
    try {
      const body: Record<string, unknown> = { source };
      if (source === "image" || source === "pdf") {
        if (!picked) {
          Alert.alert(source === "pdf" ? "Pick a PDF" : "Pick a photo",
            source === "pdf" ? "Choose a PDF of your menu first." : "Choose a photo of your menu first.");
          return;
        }
        setStatus("uploading");
        body.fileName = picked.name;
        body.objectPath = await uploadPickedFile();
        if (source === "pdf") {
          body.estimatedPages = Math.max(1, Math.ceil(picked.size / 100_000));
        }
      } else if (source === "url") {
        if (!/^https?:\/\//i.test(url.trim())) { Alert.alert("Invalid URL", "Enter a full https:// URL."); return; }
        body.url = url.trim();
      } else {
        if (text.trim().length < 5) { Alert.alert("Paste menu text", "Paste the menu text first (at least a few items)."); return; }
        if (text.length > 200_000) { Alert.alert("Too long", "Text is too long (max 200,000 characters)."); return; }
        body.text = text;
      }
      safe(setStatus)("starting");
      const res = await api.post<{ id: number }>(`/restaurants/${restaurantId}/ai/menu-import/start`, body);
      if (cancelledRef.current || !mountedRef.current) return;
      safe(setImportId)(res.id);
      safe(setStatus)("processing");
      void pollDetail(res.id);
    } catch (e) {
      if (cancelledRef.current || !mountedRef.current) return;
      safe(setStatus)("error");
      safe(setError)(e instanceof Error ? e.message : "Could not start import.");
    }
  }

  const isBusy = status === "uploading" || status === "starting" || status === "processing" || status === "saving";

  if (!open) {
    return (
      <Pressable
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.importCta, { borderColor: colors.primary, backgroundColor: colors.primary + "10", opacity: pressed ? 0.85 : 1 }]}
        testID="menu-import-open"
      >
        <Ionicons name="sparkles-outline" size={18} color={colors.primary} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>Import menu with AI</Text>
          <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 2 }}>Photo, link or paste — AI extracts items automatically.</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.primary} />
      </Pressable>
    );
  }

  return (
    <View style={[styles.importCard, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Ionicons name="sparkles" size={16} color={colors.primary} />
        <Text style={{ flex: 1, color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>AI Menu Import</Text>
        <Pressable onPress={() => { reset(); setOpen(false); }} hitSlop={10}>
          <Ionicons name="close" size={18} color={colors.mutedForeground} />
        </Pressable>
      </View>

      {!importId && (
        <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {(["image", "pdf", "url", "text"] as ImportSource[]).map((s) => {
              const icon =
                s === "image" ? "image-outline" :
                s === "pdf" ? "document-outline" :
                s === "url" ? "link-outline" : "document-text-outline";
              const label =
                s === "image" ? "Photo" : s === "pdf" ? "PDF" : s === "url" ? "URL" : "Text";
              const active = source === s;
              return (
                <Pressable
                  key={s}
                  onPress={() => { setSource(s); setPicked(null); }}
                  style={[styles.importTab, {
                    borderColor: active ? colors.primary : colors.border,
                    backgroundColor: active ? colors.primary + "12" : "transparent",
                  }]}
                >
                  <Ionicons name={icon} size={14} color={active ? colors.primary : colors.mutedForeground} />
                  <Text style={{ color: active ? colors.primary : colors.mutedForeground, fontSize: 12, fontFamily: "Inter_500Medium" }}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {(source === "image" || source === "pdf") && (
            <View style={{ gap: 8 }}>
              <Pressable onPress={source === "pdf" ? pickPdf : pickPhoto} disabled={isBusy}
                style={({ pressed }) => [styles.uploadDrop, { borderColor: colors.border, opacity: pressed ? 0.85 : 1 }]}>
                <Ionicons name={source === "pdf" ? "document-outline" : "cloud-upload-outline"} size={22} color={colors.mutedForeground} />
                <Text style={{ color: colors.foreground, fontFamily: "Inter_500Medium", fontSize: 13 }}>
                  {picked
                    ? (source === "pdf" ? "Change PDF" : "Change photo")
                    : (source === "pdf" ? "Pick a PDF of your menu" : "Pick a photo of your menu")}
                </Text>
                {picked && (
                  <Text style={{ color: colors.mutedForeground, fontSize: 11 }} numberOfLines={1}>
                    {picked.name} · {(picked.size / 1024).toFixed(0)} KB
                  </Text>
                )}
              </Pressable>
              <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>
                {source === "pdf"
                  ? "PDF up to 10 MB. Charged per page."
                  : "Best results with a flat, well-lit photo. JPG / PNG up to 10 MB."}
              </Text>
            </View>
          )}

          {source === "url" && (
            <View style={{ gap: 6 }}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>Menu URL</Text>
              <BasicInput
                value={url}
                onChangeText={setUrl}
                placeholder="https://example.com/menu"
                colors={colors}
                autoCapitalize="none"
              />
              <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>Works best for plain HTML menus.</Text>
            </View>
          )}

          {source === "text" && (
            <View style={{ gap: 6 }}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>Paste menu text</Text>
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder={"Paneer Tikka — 249\nButter Naan — 60\nVeg Biryani — 180"}
                placeholderTextColor={colors.mutedForeground}
                multiline
                numberOfLines={6}
                style={[styles.textArea, { borderColor: colors.border, color: colors.foreground }]}
              />
            </View>
          )}

          {status === "uploading" && <StatusRow icon="cloud-upload" label="Uploading photo…" colors={colors} spinning />}
          {status === "starting" && <StatusRow icon="rocket-outline" label="Starting import…" colors={colors} spinning />}
          {status === "error" && error && (
            <View style={{ flexDirection: "row", gap: 8, padding: 10, borderRadius: 8, backgroundColor: "#fef2f2", borderWidth: 1, borderColor: "#fecaca" }}>
              <Ionicons name="alert-circle" size={18} color="#dc2626" />
              <Text style={{ color: "#991b1b", flex: 1, fontSize: 13 }}>{error}</Text>
            </View>
          )}

          <Pressable
            onPress={start}
            disabled={isBusy}
            style={({ pressed }) => [styles.primaryBtn, {
              backgroundColor: colors.primary,
              opacity: isBusy ? 0.6 : pressed ? 0.85 : 1,
              alignSelf: "flex-start",
              paddingHorizontal: 22,
            }]}
            testID="menu-import-start"
          >
            {isBusy ? <ActivityIndicator color="#fff" /> : (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Ionicons name="sparkles" size={14} color="#fff" />
                <Text style={styles.primaryBtnText}>Run import</Text>
              </View>
            )}
          </Pressable>
        </>
      )}

      {importId && (
        <View style={{ gap: 10 }}>
          {status === "uploading" && <StatusRow icon="cloud-upload" label="Uploading photo…" colors={colors} />}
          {status === "starting" && <StatusRow icon="rocket-outline" label="Starting import…" colors={colors} />}
          {status === "processing" && (
            <StatusRow icon="sync" label={`AI is reading your menu — usually 30–90 seconds${detail ? ` · ${detail.import.totalRows} item${detail.import.totalRows === 1 ? "" : "s"} so far` : ""}.`} colors={colors} spinning />
          )}
          {status === "saving" && <StatusRow icon="save-outline" label="Saving items to your menu…" colors={colors} spinning />}
          {status === "done" && (
            <View style={{ flexDirection: "row", gap: 8, padding: 10, borderRadius: 8, backgroundColor: "#ecfdf5", borderWidth: 1, borderColor: "#a7f3d0" }}>
              <Ionicons name="checkmark-circle" size={18} color="#059669" />
              <Text style={{ color: "#065f46", flex: 1, fontSize: 13 }}>{error ?? "Done."}</Text>
            </View>
          )}
          {status === "error" && (
            <View style={{ flexDirection: "row", gap: 8, padding: 10, borderRadius: 8, backgroundColor: "#fef2f2", borderWidth: 1, borderColor: "#fecaca" }}>
              <Ionicons name="alert-circle" size={18} color="#dc2626" />
              <Text style={{ color: "#991b1b", flex: 1, fontSize: 13 }}>{error ?? "Something went wrong."}</Text>
            </View>
          )}
          {(status === "done" || status === "error") && (
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable onPress={reset} style={({ pressed }) => [styles.ghostBtn, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}>
                <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: "Inter_500Medium" }}>Import another</Text>
              </Pressable>
              <Pressable onPress={() => { reset(); setOpen(false); }} style={({ pressed }) => [styles.ghostBtn, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}>
                <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: "Inter_500Medium" }}>Close</Text>
              </Pressable>
            </View>
          )}
        </View>
      )}

    </View>
  );
}

function StatusRow({ icon, label, colors, spinning }: { icon: keyof typeof Ionicons.glyphMap; label: string; colors: ReturnType<typeof useColors>; spinning?: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 8, backgroundColor: colors.muted }}>
      {spinning ? <ActivityIndicator color={colors.primary} size="small" /> : <Ionicons name={icon} size={16} color={colors.primary} />}
      <Text style={{ color: colors.foreground, fontSize: 13, flex: 1 }}>{label}</Text>
    </View>
  );
}

function TablesStep({ restaurantId, api, onChanged, onAdvance, colors }: StepProps) {
  const [tables, setTables] = useState<{ id: number; tableNumber: string; capacity: number }[]>([]);
  const [bulk, setBulk] = useState({ count: "5", prefix: "T", capacity: "4" });
  const [busy, setBusy] = useState(false);

  async function reload() {
    try { setTables(await api.get(`/restaurants/${restaurantId}/tables`)); } catch {}
  }
  useEffect(() => { void reload(); }, [restaurantId]);

  async function add() {
    setBusy(true);
    const count = Math.max(1, Math.min(50, Number(bulk.count) || 0));
    const start = tables.length + 1;
    let created = 0;
    try {
      for (let i = 0; i < count; i++) {
        await api.post(`/restaurants/${restaurantId}/tables`, {
          tableNumber: `${bulk.prefix}${start + i}`,
          capacity: Number(bulk.capacity) || 4,
        });
        created++;
      }
      Alert.alert("Added", `${created} tables added.`);
    } catch (e) {
      Alert.alert("Stopped", `Added ${created}. ${e instanceof Error ? e.message : ""}`);
    } finally {
      setBusy(false);
      await reload();
      await onChanged();
    }
  }

  return (
    <View style={{ gap: 12 }}>
      <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>Bulk-add tables. Edit, rename or assign sections later from the Tables page.</Text>
      {tables.length > 0 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {tables.map(t => (
            <View key={t.id} style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: colors.muted }}>
              <Ionicons name="checkmark" size={12} color="#10b981" />
              <Text style={{ fontSize: 12, color: colors.foreground }}>{t.tableNumber}</Text>
            </View>
          ))}
        </View>
      )}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <FormField label="How many" colors={colors}>
            <BasicInput value={bulk.count} onChangeText={(v) => setBulk({ ...bulk, count: v })} keyboardType="number-pad" colors={colors} />
          </FormField>
        </View>
        <View style={{ flex: 1 }}>
          <FormField label="Prefix" colors={colors}>
            <BasicInput value={bulk.prefix} onChangeText={(v) => setBulk({ ...bulk, prefix: v })} colors={colors} />
          </FormField>
        </View>
        <View style={{ flex: 1 }}>
          <FormField label="Seats" colors={colors}>
            <BasicInput value={bulk.capacity} onChangeText={(v) => setBulk({ ...bulk, capacity: v })} keyboardType="number-pad" colors={colors} />
          </FormField>
        </View>
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Pressable onPress={add} disabled={busy}
          style={({ pressed }) => [styles.primaryBtn, { backgroundColor: colors.primary, opacity: busy ? 0.5 : pressed ? 0.85 : 1, paddingHorizontal: 22 }]}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Add {bulk.count || 0} tables</Text>}
        </Pressable>
        {tables.length > 0 && (
          <Pressable onPress={onAdvance} style={({ pressed }) => [styles.ghostBtn, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}>
            <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: "Inter_500Medium" }}>Continue</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function StaffStep({ restaurantId, api, onChanged, colors }: StepProps) {
  const [staff, setStaff] = useState<{ id: number; name: string; role: string }[]>([]);
  const [form, setForm] = useState({ name: "", email: "", role: "waiter", password: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.get<typeof staff>(`/restaurants/${restaurantId}/staff`).then(setStaff).catch(() => {});
  }, [restaurantId]);

  async function add() {
    if (!form.name.trim() || !form.email.trim() || form.password.length < 6) {
      Alert.alert("Required", "Name, email and a password (6+ chars).");
      return;
    }
    setBusy(true);
    try {
      await api.post(`/users`, { ...form, restaurantId });
      setForm({ name: "", email: "", role: "waiter", password: "" });
      const fresh = await api.get<typeof staff>(`/restaurants/${restaurantId}/staff`);
      setStaff(fresh);
      await onChanged();
    } catch (e) {
      Alert.alert("Couldn't add", e instanceof Error ? e.message : "Try again");
    } finally { setBusy(false); }
  }

  return (
    <View style={{ gap: 12 }}>
      <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>Invite waiters, kitchen staff, or managers. Optional — do this later from Staff.</Text>
      {staff.filter(s => s.role !== "owner").map(s => (
        <View key={s.id} style={[styles.listRow, { backgroundColor: colors.muted }]}>
          <Ionicons name="person-circle-outline" size={18} color={colors.foreground} />
          <Text style={{ color: colors.foreground, fontFamily: "Inter_500Medium", flex: 1 }}>{s.name}</Text>
          <Text style={{ color: colors.mutedForeground, fontSize: 12, textTransform: "capitalize" }}>{s.role}</Text>
        </View>
      ))}
      <FormField label="Name" colors={colors}>
        <BasicInput value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} placeholder="Ramesh Kumar" colors={colors} />
      </FormField>
      <FormField label="Email" colors={colors}>
        <BasicInput value={form.email} onChangeText={(v) => setForm({ ...form, email: v })} placeholder="ramesh@example.com" keyboardType="email-address" autoCapitalize="none" colors={colors} />
      </FormField>
      <FormField label="Role" colors={colors}>
        <ChoiceRow
          options={[{ id: "waiter", label: "Waiter" }, { id: "kitchen", label: "Kitchen" }, { id: "manager", label: "Manager" }]}
          selected={form.role}
          onSelect={(id) => setForm({ ...form, role: id as string })}
          colors={colors}
        />
      </FormField>
      <FormField label="Temporary password" colors={colors}>
        <BasicInput value={form.password} onChangeText={(v) => setForm({ ...form, password: v })} placeholder="At least 6 chars" colors={colors} />
      </FormField>
      <Pressable onPress={add} disabled={busy}
        style={({ pressed }) => [styles.primaryBtn, { backgroundColor: colors.primary, opacity: busy ? 0.5 : pressed ? 0.85 : 1, alignSelf: "flex-start", paddingHorizontal: 22 }]}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Add team member</Text>}
      </Pressable>
    </View>
  );
}

const PAYMENT_OPTS = [
  { id: "cash", label: "Cash" }, { id: "upi", label: "UPI" }, { id: "card", label: "Card" },
];

function PaymentStep({ restaurantId, api, onChanged, onAdvance, colors }: StepProps) {
  const [form, setForm] = useState({ taxRate: "5", serviceCharge: "0", methods: ["cash", "upi", "card"] });
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const r = await api.get<{ taxRate: string | null; serviceCharge: string | null; acceptedPaymentMethods: string[] | null }>(`/restaurants/${restaurantId}`);
        setForm({
          taxRate: r.taxRate ?? "5",
          serviceCharge: r.serviceCharge ?? "0",
          methods: r.acceptedPaymentMethods ?? ["cash", "upi", "card"],
        });
      } catch {}
      finally { setLoaded(true); }
    })();
  }, [restaurantId]);

  async function save() {
    if (form.methods.length === 0) { Alert.alert("Required", "Pick at least one payment method."); return; }
    setBusy(true);
    try {
      await api.patch(`/restaurants/${restaurantId}`, {
        taxRate: form.taxRate,
        serviceCharge: form.serviceCharge,
        acceptedPaymentMethods: form.methods,
      });
      await onChanged();
      onAdvance();
    } catch (e) {
      Alert.alert("Save failed", e instanceof Error ? e.message : "Try again");
    } finally { setBusy(false); }
  }

  if (!loaded) return <ActivityIndicator color={colors.primary} />;

  return (
    <View style={{ gap: 12 }}>
      <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>Pick the tenders you accept and set tax / service charge.</Text>
      <FormField label="Payment methods" colors={colors}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {PAYMENT_OPTS.map(opt => {
            const on = form.methods.includes(opt.id);
            return (
              <Pressable
                key={opt.id}
                onPress={() => setForm(f => ({ ...f, methods: on ? f.methods.filter(m => m !== opt.id) : [...f.methods, opt.id] }))}
                style={[styles.choice, {
                  borderColor: on ? colors.primary : colors.border,
                  backgroundColor: on ? colors.primary + "14" : "transparent",
                }]}
              >
                {on && <Ionicons name="checkmark" size={14} color={colors.primary} />}
                <Text style={{ color: on ? colors.primary : colors.foreground, fontFamily: "Inter_500Medium", fontSize: 13 }}>{opt.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </FormField>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <FormField label="Tax rate (%)" colors={colors}>
            <BasicInput value={form.taxRate} onChangeText={(v) => setForm({ ...form, taxRate: v })} keyboardType="decimal-pad" colors={colors} />
          </FormField>
        </View>
        <View style={{ flex: 1 }}>
          <FormField label="Service charge (%)" colors={colors}>
            <BasicInput value={form.serviceCharge} onChangeText={(v) => setForm({ ...form, serviceCharge: v })} keyboardType="decimal-pad" colors={colors} />
          </FormField>
        </View>
      </View>
      <Pressable onPress={save} disabled={busy}
        style={({ pressed }) => [styles.primaryBtn, { backgroundColor: colors.primary, opacity: busy ? 0.5 : pressed ? 0.85 : 1, alignSelf: "flex-start", paddingHorizontal: 22 }]}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Save and continue</Text>}
      </Pressable>
    </View>
  );
}

function GoLiveStep({ state, onComplete, colors }: StepProps) {
  return (
    <View style={{ gap: 14 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Ionicons name="rocket-outline" size={24} color={colors.primary} />
        <Text style={{ color: colors.foreground, fontSize: 18, fontFamily: "Inter_700Bold" }}>You're ready to launch</Text>
      </View>
      <Text style={{ color: colors.mutedForeground, fontSize: 14, lineHeight: 20 }}>
        Review what you've set up. You can keep editing everything from the dashboard.
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {[
          { label: "Branches", value: state.counts.branches },
          { label: "Kitchens", value: state.counts.kitchens },
          { label: "Categories", value: state.counts.categories },
          { label: "Menu items", value: state.counts.items },
          { label: "Tables", value: state.counts.tables },
          { label: "Team", value: state.counts.staff },
        ].map(s => (
          <View key={s.label} style={{
            flexBasis: "48%", padding: 12, borderRadius: 10,
            backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
          }}>
            <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{s.label}</Text>
            <Text style={{ color: colors.foreground, fontSize: 22, fontFamily: "Inter_700Bold", marginTop: 2 }}>{s.value}</Text>
          </View>
        ))}
      </View>
      <Pressable
        onPress={onComplete}
        style={({ pressed }) => [styles.primaryBtn, { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1, marginTop: 8 }]}
      >
        <Text style={styles.primaryBtnText}>Go live and open dashboard</Text>
      </Pressable>
    </View>
  );
}

// ─── primitives ──────────────────────────────────────────────────

function FormField({ label, colors, children }: { label: string; colors: ReturnType<typeof useColors>; children: React.ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: colors.mutedForeground, fontSize: 13, fontFamily: "Inter_500Medium" }}>{label}</Text>
      {children}
    </View>
  );
}

function BasicInput({
  value, onChangeText, placeholder, colors, keyboardType, autoCapitalize,
}: {
  value: string; onChangeText: (v: string) => void; placeholder?: string;
  colors: ReturnType<typeof useColors>;
  keyboardType?: "default" | "email-address" | "number-pad" | "decimal-pad" | "phone-pad";
  autoCapitalize?: "none" | "characters" | "words" | "sentences";
}) {
  return (
    <TextInput
      value={value} onChangeText={onChangeText}
      placeholder={placeholder} placeholderTextColor={colors.mutedForeground}
      keyboardType={keyboardType} autoCapitalize={autoCapitalize}
      style={{
        borderWidth: 1, borderColor: colors.border, borderRadius: 10,
        paddingHorizontal: 12, paddingVertical: Platform.OS === "ios" ? 12 : 10,
        color: colors.foreground, fontSize: 15, fontFamily: "Inter_400Regular",
        backgroundColor: colors.card,
      }}
    />
  );
}

function ChoiceRow({
  options, selected, onSelect, colors,
}: {
  options: { id: number | string; label: string }[];
  selected: number | string;
  onSelect: (id: number | string) => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {options.map(opt => {
        const on = opt.id === selected;
        return (
          <Pressable key={String(opt.id)} onPress={() => onSelect(opt.id)}
            style={[styles.choice, {
              borderColor: on ? colors.primary : colors.border,
              backgroundColor: on ? colors.primary + "14" : "transparent",
            }]}>
            <Text style={{ color: on ? colors.primary : colors.foreground, fontFamily: "Inter_500Medium", fontSize: 13 }}>{opt.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  progressBar: { height: 6, borderRadius: 3, overflow: "hidden" },
  progressFill: { height: "100%" },
  stepTitle: { fontSize: 22, fontFamily: "Inter_700Bold" },
  primaryBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16,
    alignSelf: "flex-start", justifyContent: "center",
  },
  primaryBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
  ghostBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    borderRadius: 10, paddingVertical: 12, paddingHorizontal: 14,
    borderWidth: 1,
  },
  listRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10,
  },
  checklistRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 14, borderRadius: 12, borderWidth: 1,
  },
  checklistBadge: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  choice: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1,
  },
  label: { fontSize: 12, fontFamily: "Inter_500Medium" },
  importCta: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderWidth: 1, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14,
  },
  importCard: {
    borderWidth: 1, borderRadius: 12, padding: 14, gap: 12,
  },
  importTab: {
    flexDirection: "row", alignItems: "center", gap: 4,
    borderWidth: 1, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10,
  },
  uploadDrop: {
    borderWidth: 1, borderStyle: "dashed", borderRadius: 10,
    padding: 16, alignItems: "center", gap: 6,
  },
  textArea: {
    borderWidth: 1, borderRadius: 8, padding: 10, minHeight: 110,
    textAlignVertical: "top", fontSize: 14, fontFamily: "Inter_400Regular",
  },
});
