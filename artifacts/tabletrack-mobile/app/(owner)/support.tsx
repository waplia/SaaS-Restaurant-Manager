import React, { useState } from "react";
import { View, Text, ScrollView, StyleSheet, RefreshControl, Pressable, TextInput, Alert, Platform, KeyboardAvoidingView } from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { SectionHeader } from "@/components/SectionHeader";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";

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
    queryFn: () => customFetch<Ticket[] | { tickets?: Ticket[] }>(`/api/support/tickets`).catch(() => []),
  });
  const list: Ticket[] = Array.isArray(q.data) ? q.data : (q.data?.tickets ?? []);

  const create = useMutation({
    mutationFn: () => customFetch(`/api/support/tickets`, {
      method: "POST", body: JSON.stringify({ subject, body }),
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
          <Pressable onPress={() => setShowNew(s => !s)} hitSlop={8}>
            <Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>
              {showNew ? "Cancel" : "+ New"}
            </Text>
          </Pressable>
        }
      />
      <ScrollView
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={q.refetch} tintColor={colors.primary} />}
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: isWeb ? 100 : 100 }}
      >
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
});
