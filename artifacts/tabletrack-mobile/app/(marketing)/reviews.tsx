import React, { useMemo, useState } from "react";
import { View, ActivityIndicator } from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Alert } from "@/components/ui/AppAlert";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { RoleShellScreen } from "@/components/RoleShellScreen";
import {
  AppText, AppCard, AppButton, AppBottomSheet, AppInput, AppEmptyState, AppIcon, StatusChip,
} from "@/components/ui";

type ExternalReview = {
  id: number; source: string; authorName: string | null;
  rating: number | null; body: string; createdAt: string;
  sentiment?: string | null; category?: string | null;
};
type Feedback = {
  id: number; rating: number | null; comment?: string | null; body?: string | null;
  customerName?: string | null; createdAt: string;
};
type ReplyDraft = {
  id: number; externalReviewId: number | null; draftReply: string;
  finalReply?: string | null; status: string;
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function ratingTone(rating: number | null) {
  if (rating == null) return "neutral" as const;
  if (rating >= 4) return "success" as const;
  if (rating === 3) return "warning" as const;
  return "danger" as const;
}

export default function MarketingReviewsScreen() {
  const colors = useColors();
  const { restaurantId } = useAuth();
  const qc = useQueryClient();
  const [active, setActive] = useState<{ kind: "external" | "feedback"; id: number; body: string; rating: number | null } | null>(null);

  const externalQ = useQuery({
    queryKey: ["marketing-external-reviews", restaurantId],
    queryFn: () => customFetch<ExternalReview[]>(`/api/restaurants/${restaurantId}/reviews/external?limit=50`),
  });
  const feedbackQ = useQuery({
    queryKey: ["marketing-feedback", restaurantId],
    queryFn: () => customFetch<Feedback[]>(`/api/restaurants/${restaurantId}/reviews/feedback?limit=50`),
  });
  const repliesQ = useQuery({
    queryKey: ["marketing-review-replies", restaurantId],
    queryFn: () => customFetch<ReplyDraft[]>(`/api/restaurants/${restaurantId}/reviews/replies?limit=100`),
  });

  const externalReviews = externalQ.data ?? [];
  const feedback = feedbackQ.data ?? [];
  const replies = repliesQ.data ?? [];

  const items = useMemo(() => {
    const merged: Array<{ kind: "external" | "feedback"; id: number; rating: number | null; body: string; author: string; createdAt: string }> = [];
    for (const r of externalReviews) {
      merged.push({
        kind: "external", id: r.id, rating: r.rating,
        body: r.body, author: r.authorName ?? r.source, createdAt: r.createdAt,
      });
    }
    for (const f of feedback) {
      merged.push({
        kind: "feedback", id: f.id, rating: f.rating,
        body: f.comment ?? f.body ?? "", author: f.customerName ?? "Guest", createdAt: f.createdAt,
      });
    }
    merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return merged;
  }, [externalReviews, feedback]);

  const replyByReview = useMemo(() => {
    const m = new Map<number, ReplyDraft>();
    for (const r of replies) {
      if (r.externalReviewId) {
        const prev = m.get(r.externalReviewId);
        if (!prev || r.id > prev.id) m.set(r.externalReviewId, r);
      }
    }
    return m;
  }, [replies]);

  const onRefresh = async () => {
    await Promise.all([externalQ.refetch(), feedbackQ.refetch(), repliesQ.refetch()]);
  };

  return (
    <RoleShellScreen
      title="Reviews"
      subtitle="Reply to recent customer feedback"
      onRefresh={onRefresh}
      refreshing={externalQ.isRefetching || feedbackQ.isRefetching}
    >
      {externalQ.isLoading || feedbackQ.isLoading ? (
        <ActivityIndicator color={colors.primary} />
      ) : items.length === 0 ? (
        <AppEmptyState icon="chatbubbles-outline" title="No reviews yet" description="When customers leave reviews or feedback they'll show up here." />
      ) : (
        items.map(it => {
          const reply = it.kind === "external" ? replyByReview.get(it.id) : undefined;
          return (
            <AppCard key={`${it.kind}-${it.id}`} padding={14} style={{ gap: 8 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <StatusChip
                  label={it.rating != null ? `${it.rating}/5` : "—"}
                  tone={ratingTone(it.rating)}
                  size="xs"
                  icon="star"
                />
                <AppText variant="small" weight="semibold">{it.author}</AppText>
                <AppText variant="micro" color="mutedForeground">{timeAgo(it.createdAt)}</AppText>
                {reply?.status === "posted" ? (
                  <StatusChip label="Replied" tone="success" size="xs" />
                ) : reply ? (
                  <StatusChip label="Draft" tone="info" size="xs" />
                ) : null}
              </View>
              <AppText variant="small">{it.body || "(no comment)"}</AppText>
              {it.kind === "external" ? (
                <AppButton
                  label={reply ? "Edit reply" : "Reply"}
                  variant="outline"
                  size="sm"
                  leftIcon="arrow-undo-outline"
                  onPress={() => setActive({ kind: it.kind, id: it.id, body: it.body, rating: it.rating })}
                />
              ) : (
                <AppText variant="micro" color="mutedForeground">
                  Private feedback — no public reply.
                </AppText>
              )}
            </AppCard>
          );
        })
      )}

      {active ? (
        <ReplySheet
          visible={!!active}
          onClose={() => setActive(null)}
          restaurantId={restaurantId}
          review={active}
          existingDraft={replyByReview.get(active.id) ?? null}
          onSaved={() => {
            setActive(null);
            qc.invalidateQueries({ queryKey: ["marketing-review-replies", restaurantId] });
          }}
        />
      ) : null}
    </RoleShellScreen>
  );
}

function ReplySheet({
  visible, onClose, restaurantId, review, existingDraft, onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  restaurantId: number;
  review: { kind: "external" | "feedback"; id: number; body: string; rating: number | null };
  existingDraft: ReplyDraft | null;
  onSaved: () => void;
}) {
  const [reply, setReply] = useState(existingDraft?.finalReply ?? existingDraft?.draftReply ?? "");

  React.useEffect(() => {
    setReply(existingDraft?.finalReply ?? existingDraft?.draftReply ?? "");
  }, [existingDraft, visible]);

  const aiSuggestM = useMutation({
    mutationFn: () => customFetch<{ draft: ReplyDraft }>(
      `/api/restaurants/${restaurantId}/reviews/ai-reply`,
      {
        method: "POST",
        body: JSON.stringify({
          body: review.body, rating: review.rating, externalReviewId: review.id, tone: "friendly",
        }),
      },
    ),
    onSuccess: (r) => setReply(r.draft.draftReply ?? ""),
    onError: (err) => Alert.alert("AI helper unavailable", err instanceof Error ? err.message : "Try again later or write a reply yourself."),
  });

  const sendM = useMutation({
    mutationFn: async () => {
      let draftId = existingDraft?.id;
      // Without an existing draft, create a plain (non-AI) draft so a
      // hand-written reply can always be sent even when AI is unavailable.
      if (!draftId) {
        const made = await customFetch<{ draft: ReplyDraft }>(
          `/api/restaurants/${restaurantId}/reviews/replies`,
          {
            method: "POST",
            body: JSON.stringify({
              externalReviewId: review.id,
              draftReply: reply,
              reviewSnapshot: review.body,
              tone: "friendly",
            }),
          },
        );
        draftId = made.draft.id;
      }
      return customFetch(`/api/restaurants/${restaurantId}/reviews/replies/${draftId}`, {
        method: "PATCH",
        body: JSON.stringify({ finalReply: reply, status: "posted", postedTo: "copy" }),
      });
    },
    onSuccess: () => {
      Alert.alert("Reply marked as sent", "Copy the text and paste it to the review site.");
      onSaved();
    },
    onError: (err) => Alert.alert("Failed", err instanceof Error ? err.message : "Could not save"),
  });

  return (
    <AppBottomSheet visible={visible} onClose={onClose} title="Reply to review">
      <AppCard padding={10} style={{ gap: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <AppIcon name="star" size={14} color="warning" />
          <AppText weight="semibold">{review.rating ?? "—"}/5</AppText>
        </View>
        <AppText variant="small">{review.body}</AppText>
      </AppCard>

      <AppButton
        label={existingDraft ? "Re-generate with AI" : "Suggest a reply"}
        variant="outline"
        leftIcon="sparkles-outline"
        loading={aiSuggestM.isPending}
        onPress={() => aiSuggestM.mutate()}
      />

      <AppInput
        label="Your reply"
        multiline
        numberOfLines={6}
        value={reply}
        onChangeText={setReply}
        placeholder="Thanks for visiting us..."
      />

      <AppButton
        label="Send"
        loading={sendM.isPending}
        disabled={!reply.trim()}
        onPress={() => sendM.mutate()}
      />
    </AppBottomSheet>
  );
}
