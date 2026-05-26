import React, { useState } from "react";
import { Alert } from "@/components/ui/AppAlert";
import { View, Text, ScrollView, StyleSheet, RefreshControl, Pressable, TextInput, Platform, KeyboardAvoidingView, Linking } from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { SectionHeader } from "@/components/SectionHeader";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";

type PublicAppSettings = {
  appName?: string;
  supportEmail?: string | null;
  supportPhone?: string | null;
  supportWhatsapp?: string | null;
};

type Ticket = {
  id: number;
  subject: string;
  status: "open" | "pending" | "resolved" | "closed" | string;
  priority?: string;
  createdAt: string;
  lastReplyAt?: string | null;
};

export default function SupportScreen() {
  const colors = useColors();
  const qc = useQueryClient();
  const isWeb = Platform.OS === "web";
  const [showNew, setShowNew] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const q = useQuery({
    queryKey: ["support-tickets"],
    queryFn: () => customFetch<Ticket[] | { data?: Ticket[]; tickets?: Ticket[] }>(`/api/support/tickets`).catch(() => []),
  });
  const list: Ticket[] = Array.isArray(q.data) ? q.data : (q.data?.data ?? q.data?.tickets ?? []);

  // Public settings — these power the contact buttons (WhatsApp, phone,
  // email) and are configurable by Super Admin from /admin-settings. The
  // /public/app-settings endpoint is unauthenticated and short-cached, so
  // changes go live everywhere within ~15s without a code deploy.
  const settingsQ = useQuery<PublicAppSettings>({
    queryKey: ["public-app-settings-support"],
    queryFn: () => customFetch<PublicAppSettings>(`/api/public/app-settings`).catch(() => ({})),
    staleTime: 60_000,
  });
  const s = settingsQ.data ?? {};

  const openWhatsapp = (raw: string) => {
    const digits = raw.replace(/[^\d+]/g, "").replace(/^\+/, "");
    const appName = s.appName ?? "TableTrack";
    const text = encodeURIComponent(`Hi ${appName} support, I need help with my account.`);
    Linking.openURL(`https://wa.me/${digits}?text=${text}`).catch(() => {
      Alert.alert("Couldn't open WhatsApp", "Please install WhatsApp or use email instead.");
    });
  };

  const create = useMutation({
    mutationFn: () => customFetch(`/api/support/tickets`, {
      method: "POST", body: JSON.stringify({ subject, description: body }),
    }),
    onSuccess: () => {
      setShowNew(false); setSubject(""); setBody("");
      qc.invalidateQueries({ queryKey: ["support-tickets"] });
      Alert.alert("Ticket opened", "We'll reply by email shortly.");
    },
    onError: (e: unknown) => Alert.alert("Failed", e instanceof Error ? e.message : "Could not open ticket"),
  });

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <SectionHeader
        title="Support"
        showBack
        right={
          <Pressable onPress={() => setShowNew(s => !s)} hitSlop={10}>
            <Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>
              {showNew ? "Cancel" : "+ New"}
            </Text>
          </Pressable>
        }
      />
      <ScrollView
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => { q.refetch(); settingsQ.refetch(); }} tintColor={colors.primary} />}
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: isWeb ? 100 : 100 }}
      >
        {/* Quick-contact row — shown only for channels the admin has configured.
            Tapping each opens the appropriate native app (WhatsApp, dialer, mail). */}
        {(s.supportWhatsapp || s.supportPhone || s.supportEmail) ? (
          <View style={[styles.contactCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.contactTitle, { color: colors.foreground }]}>Talk to us directly</Text>
            <View style={styles.contactRow}>
              {s.supportWhatsapp ? (
                <Pressable
                  onPress={() => openWhatsapp(s.supportWhatsapp!)}
                  style={({ pressed }) => [styles.contactBtn, { backgroundColor: "#25D366", opacity: pressed ? 0.85 : 1 }]}
                >
                  <Ionicons name="logo-whatsapp" size={16} color="#fff" />
                  <Text style={styles.contactBtnText}>WhatsApp</Text>
                </Pressable>
              ) : null}
              {s.supportPhone ? (
                <Pressable
                  onPress={() => Linking.openURL(`tel:${s.supportPhone}`).catch(() => {})}
                  style={({ pressed }) => [styles.contactBtn, { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 }]}
                >
                  <Ionicons name="call" size={16} color="#fff" />
                  <Text style={styles.contactBtnText}>Call</Text>
                </Pressable>
              ) : null}
              {s.supportEmail ? (
                <Pressable
                  onPress={() => Linking.openURL(`mailto:${s.supportEmail}`).catch(() => {})}
                  style={({ pressed }) => [styles.contactBtn, { backgroundColor: colors.foreground, opacity: pressed ? 0.85 : 1 }]}
                >
                  <Ionicons name="mail" size={16} color={colors.background} />
                  <Text style={[styles.contactBtnText, { color: colors.background }]}>Email</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}

        {showNew ? (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, gap: 10 }]}>
            <TextInput
              placeholder="Subject"
              placeholderTextColor={colors.mutedForeground}
              value={subject}
              onChangeText={setSubject}
              style={[styles.input, { color: colors.foreground, borderColor: colors.border }]}
            />
            <TextInput
              placeholder="Describe the issue…"
              placeholderTextColor={colors.mutedForeground}
              value={body}
              onChangeText={setBody}
              multiline
              numberOfLines={4}
              style={[styles.input, { color: colors.foreground, borderColor: colors.border, minHeight: 100, textAlignVertical: "top" }]}
            />
            <Pressable
              onPress={() => create.mutate()}
              disabled={!subject.trim() || !body.trim() || create.isPending}
              style={({ pressed }) => [
                styles.submit,
                { backgroundColor: colors.primary, opacity: !subject.trim() || !body.trim() ? 0.4 : pressed ? 0.85 : 1 },
              ]}
            >
              <Text style={styles.submitText}>{create.isPending ? "Sending…" : "Open ticket"}</Text>
            </Pressable>
          </View>
        ) : null}

        {list.length === 0 ? (
          <View style={{ marginTop: 30 }}>
            <EmptyState icon="help-buoy-outline" title="No tickets yet" message="Tap '+ New' to contact support." />
          </View>
        ) : (
          list.map(t => (
            <View key={t.id} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.headerRow}>
                <Text style={[styles.subject, { color: colors.foreground }]} numberOfLines={1}>{t.subject}</Text>
                <StatusBadge label={t.status} tone={t.status === "open" ? "warning" : t.status === "resolved" ? "success" : "neutral"} />
              </View>
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                #{t.id} · opened {new Date(t.createdAt).toLocaleDateString()}
                {t.lastReplyAt ? ` · last reply ${new Date(t.lastReplyAt).toLocaleDateString()}` : ""}
              </Text>
            </View>
          ))
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: 1, padding: 12, gap: 6 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  subject: { flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold" },
  meta: { fontSize: 11, fontFamily: "Inter_400Regular" },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 10, fontFamily: "Inter_400Regular", fontSize: 14 },
  submit: { paddingVertical: 12, borderRadius: 10, alignItems: "center" },
  submitText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  contactCard: { borderRadius: 14, borderWidth: 1, padding: 12, gap: 10 },
  contactTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  contactRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  contactBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
  },
  contactBtnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
