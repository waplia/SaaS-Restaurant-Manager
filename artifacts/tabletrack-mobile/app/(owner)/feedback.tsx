import React, { useState } from "react";
import { Alert } from "@/components/ui/AppAlert";
import { View, Text, ScrollView, StyleSheet, RefreshControl, Platform, Pressable, TextInput } from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { SectionHeader } from "@/components/SectionHeader";
import { EmptyState } from "@/components/EmptyState";
import { EntityFormSheet, FormField, formInputStyle } from "@/components/EntityFormSheet";

type Review = {
  id: number;
  rating: number;
  comment?: string | null;
  body?: string | null;
  customerName?: string;
  authorName?: string | null;
  source?: string;
  createdAt: string;
  postedAt?: string | null;
  reply?: string | null;
  finalReply?: string | null;
  replyId?: number | null;
};

type RecoveryTask = {
  id: number;
  feedbackId?: number | null;
  externalReviewId?: number | null;
  status: "new" | "contacted" | "resolved" | "ignored" | string;
};

export default function FeedbackScreen() {
  const colors = useColors();
  const { restaurantId } = useAuth();
  const qc = useQueryClient();
  const isWeb = Platform.OS === "web";
  const [replying, setReplying] = useState<Review | null>(null);

  const q = useQuery({
    queryKey: ["reviews", restaurantId],
    queryFn: () => customFetch<{ reviews?: Review[] } | Review[]>(`/api/restaurants/${restaurantId}/reviews?limit=50`).catch(() => []),
  });
  const list: Review[] = Array.isArray(q.data) ? q.data : (q.data?.reviews ?? []);
  const avg = list.length ? list.reduce((s, r) => s + (r.rating ?? 0), 0) / list.length : 0;

  // Recovery tasks track resolve/escalate state for negative feedback.
  const recoveryQ = useQuery({
    queryKey: ["recovery-tasks", restaurantId],
    queryFn: () => customFetch<{ tasks?: RecoveryTask[] } | RecoveryTask[]>(
      `/api/restaurants/${restaurantId}/reviews/recovery`,
    ).catch(() => []),
  });
  const recoveryByReview = new Map<number, RecoveryTask>();
  const recoveryList: RecoveryTask[] = Array.isArray(recoveryQ.data)
    ? recoveryQ.data
    : (recoveryQ.data?.tasks ?? []);
  for (const t of recoveryList) {
    if (t.externalReviewId) recoveryByReview.set(t.externalReviewId, t);
  }

  const errToast = (e: unknown) => Alert.alert("Failed", e instanceof Error ? e.message : "Could not save reply");
  const invalidate = () => qc.invalidateQueries({ queryKey: ["reviews", restaurantId] });
  const invalidateRecovery = () => qc.invalidateQueries({ queryKey: ["recovery-tasks", restaurantId] });

  // Resolve / escalate a review. If a recovery task already exists, PATCH its
  // status; otherwise run the AI analyze endpoint first to create one, then
  // PATCH. This mirrors the web dashboard's behaviour.
  const ensureRecoveryTask = async (review: Review): Promise<number> => {
    const existing = recoveryByReview.get(review.id);
    if (existing) return existing.id;
    const created = await customFetch<{ task?: { id: number } }>(
      `/api/restaurants/${restaurantId}/reviews/recovery/analyze/external`,
      {
        method: "POST",
        body: JSON.stringify({ externalReviewId: review.id }),
      },
    ).catch(async () => {
      // Some servers route external review analysis under a different shape;
      // fall back to the generic endpoint with the review payload.
      return customFetch<{ task?: { id: number } }>(
        `/api/restaurants/${restaurantId}/reviews/recovery/analyze`,
        {
          method: "POST",
          body: JSON.stringify({
            sourceKind: "external",
            sourceId: review.id,
            rating: review.rating,
            body: review.comment ?? review.body ?? "",
          }),
        },
      );
    });
    const id = created?.task?.id;
    if (!id) throw new Error("Could not start a recovery task for this review");
    return id;
  };

  const statusM = useMutation({
    mutationFn: async ({ review, status, notes }: { review: Review; status: "resolved" | "ignored"; notes?: string }) => {
      const taskId = await ensureRecoveryTask(review);
      return customFetch(`/api/restaurants/${restaurantId}/reviews/recovery/${taskId}`, {
        method: "PATCH",
        body: JSON.stringify({ status, ...(notes ? { resolutionNotes: notes } : {}) }),
      });
    },
    onSuccess: () => { invalidateRecovery(); invalidate(); },
    onError: (e) => Alert.alert("Failed", e instanceof Error ? e.message : "Could not update status"),
  });

  const confirmStatus = (review: Review, status: "resolved" | "ignored") => {
    const verb = status === "resolved" ? "resolve" : "escalate";
    Alert.alert(
      status === "resolved" ? "Mark as resolved?" : "Escalate this review?",
      status === "resolved"
        ? "Mark this feedback as handled. You can still edit the reply."
        : "Flag this review for follow-up by a manager.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: verb[0].toUpperCase() + verb.slice(1),
          style: status === "ignored" ? "destructive" : "default",
          onPress: () => statusM.mutate({ review, status }),
        },
      ],
    );
  };

  // Persist a reply by creating an AI draft and then immediately posting the
  // operator's text via PATCH. The server's only public "draft reply" entry
  // point is the AI endpoint, so we POST with the operator's text as the
  // review body (sentiment is overwritten when finalReply is sent).
  const saveReplyM = useMutation({
    mutationFn: async ({ review, text }: { review: Review; text: string }) => {
      // Try to create a draft slot. If the server rejects (no AI credits or
      // plan gating), fall back to PATCHing an existing reply if present.
      if (review.replyId) {
        return customFetch(`/api/restaurants/${restaurantId}/reviews/replies/${review.replyId}`, {
          method: "PATCH",
          body: JSON.stringify({ finalReply: text, status: "edited" }),
        });
      }
      const draft = await customFetch<{ draft?: { id: number } }>(
        `/api/restaurants/${restaurantId}/reviews/ai-reply`,
        {
          method: "POST",
          body: JSON.stringify({
            body: review.comment ?? review.body ?? "(no comment)",
            rating: review.rating,
            externalReviewId: review.id,
            tone: "professional",
          }),
        },
      );
      const replyId = draft?.draft?.id;
      if (replyId) {
        return customFetch(`/api/restaurants/${restaurantId}/reviews/replies/${replyId}`, {
          method: "PATCH",
          body: JSON.stringify({ finalReply: text, status: "edited" }),
        });
      }
      throw new Error("Reply draft was not created");
    },
    onSuccess: () => { setReplying(null); invalidate(); },
    onError: errToast,
  });

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SectionHeader title="Feedback" subtitle={list.length ? `Avg ${avg.toFixed(1)} ★ from ${list.length}` : undefined} showBack />
      {list.length === 0 ? (
        <EmptyState icon="star-outline" title="No reviews yet" message="Reviews from QR menus and Google will appear here." />
      ) : (
        <ScrollView
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={q.refetch} tintColor={colors.primary} />}
          contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: isWeb ? 100 : 100 }}
        >
          {list.map(r => {
            const reply = r.finalReply ?? r.reply ?? null;
            const comment = r.comment ?? r.body ?? null;
            const when = r.createdAt ?? r.postedAt ?? null;
            return (
              <View key={r.id} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.headerRow}>
                  <View style={{ flexDirection: "row", gap: 2 }}>
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Ionicons
                        key={i}
                        name={i < r.rating ? "star" : "star-outline"}
                        size={14}
                        color={i < r.rating ? "#f59e0b" : colors.mutedForeground}
                      />
                    ))}
                  </View>
                  <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                    {r.customerName ?? r.authorName ?? "Guest"}
                    {when ? ` · ${new Date(when).toLocaleDateString()}` : ""}
                    {r.source ? ` · ${r.source}` : ""}
                  </Text>
                </View>
                {comment ? (
                  <Text style={[styles.comment, { color: colors.foreground }]}>{comment}</Text>
                ) : null}
                {reply ? (
                  <View style={[styles.reply, { backgroundColor: colors.accent }]}>
                    <Text style={[styles.replyLabel, { color: colors.primary }]}>Your reply</Text>
                    <Text style={[styles.replyText, { color: colors.foreground }]}>{reply}</Text>
                  </View>
                ) : null}
                {(() => {
                  const task = recoveryByReview.get(r.id);
                  const isResolved = task?.status === "resolved";
                  const isIgnored = task?.status === "ignored";
                  const busy = statusM.isPending;
                  return (
                    <>
                      {task ? (
                        <Text style={[styles.statusBadge, {
                          color: isResolved ? "#16a34a" : isIgnored ? colors.mutedForeground : "#ea580c",
                        }]}>
                          {isResolved ? "Resolved" : isIgnored ? "Escalated" : "Open follow-up"}
                        </Text>
                      ) : null}
                      <View style={styles.actionRow}>
                        <Pressable
                          onPress={() => setReplying(r)}
                          style={({ pressed }) => [
                            styles.actionBtn,
                            { borderColor: colors.primary, opacity: pressed ? 0.7 : 1 },
                          ]}
                        >
                          <Ionicons name="chatbubble-ellipses-outline" size={14} color={colors.primary} />
                          <Text style={[styles.actionBtnText, { color: colors.primary }]}>
                            {reply ? "Edit reply" : "Write reply"}
                          </Text>
                        </Pressable>
                        <Pressable
                          disabled={busy || isResolved}
                          onPress={() => confirmStatus(r, "resolved")}
                          style={({ pressed }) => [
                            styles.actionBtn,
                            {
                              borderColor: "#16a34a",
                              opacity: (busy || isResolved) ? 0.4 : (pressed ? 0.7 : 1),
                            },
                          ]}
                        >
                          <Ionicons name="checkmark-circle-outline" size={14} color="#16a34a" />
                          <Text style={[styles.actionBtnText, { color: "#16a34a" }]}>
                            {isResolved ? "Resolved" : "Resolve"}
                          </Text>
                        </Pressable>
                        <Pressable
                          disabled={busy || isIgnored}
                          onPress={() => confirmStatus(r, "ignored")}
                          style={({ pressed }) => [
                            styles.actionBtn,
                            {
                              borderColor: "#ea580c",
                              opacity: (busy || isIgnored) ? 0.4 : (pressed ? 0.7 : 1),
                            },
                          ]}
                        >
                          <Ionicons name="flag-outline" size={14} color="#ea580c" />
                          <Text style={[styles.actionBtnText, { color: "#ea580c" }]}>
                            {isIgnored ? "Escalated" : "Escalate"}
                          </Text>
                        </Pressable>
                      </View>
                    </>
                  );
                })()}
              </View>
            );
          })}
        </ScrollView>
      )}

      <ReplyForm
        visible={!!replying}
        review={replying}
        submitting={saveReplyM.isPending}
        onClose={() => setReplying(null)}
        onSubmit={(text) => replying && saveReplyM.mutate({ review: replying, text })}
      />
    </View>
  );
}

function ReplyForm({
  visible, review, submitting, onClose, onSubmit,
}: {
  visible: boolean;
  review: Review | null;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (text: string) => void;
}) {
  const colors = useColors();
  const [text, setText] = useState("");

  React.useEffect(() => {
    if (visible) setText(review?.finalReply ?? review?.reply ?? "");
  }, [visible, review]);

  return (
    <EntityFormSheet
      visible={visible} onClose={onClose}
      title={review?.finalReply || review?.reply ? "Edit reply" : "Write reply"}
      submitting={submitting}
      canSubmit={text.trim().length > 0 && !submitting}
      onSubmit={() => onSubmit(text.trim())}
      submitLabel="Save reply"
    >
      {review ? (
        <View style={{ padding: 10, borderRadius: 8, borderWidth: 1, borderColor: colors.border, marginTop: 8 }}>
          <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: "Inter_500Medium", marginBottom: 4 }}>
            {review.customerName ?? review.authorName ?? "Guest"} · {review.rating} ★
          </Text>
          <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 }}>
            {review.comment ?? review.body ?? "(no comment)"}
          </Text>
        </View>
      ) : null}
      <FormField label="Your reply">
        <TextInput
          value={text}
          onChangeText={setText}
          multiline
          numberOfLines={5}
          placeholder="Thank the guest, address the concern, invite them back."
          placeholderTextColor={colors.mutedForeground}
          style={[formInputStyle(colors), { minHeight: 110, textAlignVertical: "top" }]}
        />
      </FormField>
    </EntityFormSheet>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: 1, padding: 12, gap: 8 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  meta: { fontSize: 11, fontFamily: "Inter_400Regular" },
  comment: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  reply: { padding: 10, borderRadius: 10, gap: 4 },
  replyLabel: { fontSize: 10, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5 },
  replyText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  actionRow: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  actionBtn: {
    flex: 1, minWidth: 96,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4,
    paddingVertical: 8, paddingHorizontal: 6, borderRadius: 8, borderWidth: 1,
  },
  actionBtnText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  statusBadge: { fontSize: 10, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5 },
});
