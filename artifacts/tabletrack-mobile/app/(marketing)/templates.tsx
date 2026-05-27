import React, { useMemo, useState } from "react";
import { View, ActivityIndicator, Pressable, ScrollView } from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Alert } from "@/components/ui/AppAlert";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { RoleShellScreen } from "@/components/RoleShellScreen";
import {
  AppText, AppCard, AppButton, AppInput, AppBottomSheet, AppEmptyState, AppIcon, StatusChip,
} from "@/components/ui";

type Template = {
  id: number; name: string; category?: string | null; body: string;
  title?: string | null; isGlobal?: boolean; updatedAt: string;
};
type PlanInfo = { flags: { sms: boolean; whatsapp: boolean; email: boolean; push: boolean } };

const CHANNELS = [
  { key: "whatsapp", label: "WhatsApp" },
  { key: "sms", label: "SMS" },
  { key: "email", label: "Email" },
  { key: "push", label: "Push" },
] as const;
type ChannelKey = typeof CHANNELS[number]["key"];

export default function MarketingTemplatesScreen() {
  const colors = useColors();
  const { restaurantId } = useAuth();
  const qc = useQueryClient();

  const planQ = useQuery({
    queryKey: ["marketing-plan-info", restaurantId],
    queryFn: () => customFetch<PlanInfo>(`/api/restaurants/${restaurantId}/growth/plan-info`),
  });

  const enabledChannels = useMemo(
    () => CHANNELS.filter(c => planQ.data?.flags?.[c.key]),
    [planQ.data],
  );
  const [channel, setChannel] = useState<ChannelKey | null>(null);

  React.useEffect(() => {
    if (!channel && enabledChannels[0]) setChannel(enabledChannels[0].key);
  }, [enabledChannels, channel]);

  const templatesQ = useQuery({
    queryKey: ["marketing-templates", restaurantId, channel],
    queryFn: () => customFetch<Template[]>(`/api/restaurants/${restaurantId}/growth/templates/${channel}`),
    enabled: !!channel,
  });

  const [editing, setEditing] = useState<Template | null>(null);
  const [creating, setCreating] = useState(false);

  if (planQ.isLoading) {
    return (
      <RoleShellScreen title="Templates">
        <ActivityIndicator color={colors.primary} />
      </RoleShellScreen>
    );
  }

  if (enabledChannels.length === 0) {
    return (
      <RoleShellScreen title="Templates">
        <AppEmptyState
          icon="lock-closed-outline"
          title="No channels enabled"
          description="Templates appear when your plan includes SMS, WhatsApp, or push channels."
        />
      </RoleShellScreen>
    );
  }

  return (
    <RoleShellScreen
      title="Templates"
      subtitle="Reusable message bodies per channel"
      onRefresh={async () => { await templatesQ.refetch(); }}
      refreshing={templatesQ.isRefetching}
    >
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {enabledChannels.map(c => {
          const active = channel === c.key;
          return (
            <Pressable
              key={c.key}
              onPress={() => setChannel(c.key)}
              style={{
                paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1,
                borderColor: active ? colors.primary : colors.border,
                backgroundColor: active ? colors.primary : "transparent",
              }}
            >
              <AppText variant="small" weight="semibold" color={active ? "primaryForeground" : "foreground"}>
                {c.label}
              </AppText>
            </Pressable>
          );
        })}
      </ScrollView>

      <AppButton label="New template" leftIcon="add" onPress={() => setCreating(true)} />

      {templatesQ.isLoading ? (
        <ActivityIndicator color={colors.primary} />
      ) : (templatesQ.data ?? []).length === 0 ? (
        <AppEmptyState
          icon="file-tray-outline"
          title="No templates yet"
          description={`Create your first ${channel} template to reuse across campaigns.`}
          actionLabel="Create"
          onAction={() => setCreating(true)}
        />
      ) : (
        (templatesQ.data ?? []).map(t => (
          <AppCard
            key={t.id}
            padding={12}
            onPress={() => setEditing(t)}
            style={{ gap: 6 }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <AppText weight="semibold" style={{ flex: 1 }} numberOfLines={1}>{t.name}</AppText>
              {t.isGlobal ? <StatusChip label="Built-in" tone="info" size="xs" /> : null}
              {t.category ? <StatusChip label={t.category} tone="neutral" size="xs" /> : null}
            </View>
            {t.title ? (
              <AppText variant="small" weight="semibold" numberOfLines={1}>{t.title}</AppText>
            ) : null}
            <AppText variant="small" color="mutedForeground" numberOfLines={3}>{t.body}</AppText>
          </AppCard>
        ))
      )}

      <View style={{ height: 16 }} />

      {(editing || creating) && channel ? (
        <TemplateSheet
          visible={!!(editing || creating)}
          channel={channel}
          template={editing}
          restaurantId={restaurantId}
          onClose={() => { setEditing(null); setCreating(false); }}
          onSaved={() => {
            setEditing(null); setCreating(false);
            qc.invalidateQueries({ queryKey: ["marketing-templates", restaurantId, channel] });
          }}
        />
      ) : null}
    </RoleShellScreen>
  );
}

function TemplateSheet({
  visible, onClose, channel, template, restaurantId, onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  channel: ChannelKey;
  template: Template | null;
  restaurantId: number;
  onSaved: () => void;
}) {
  const [name, setName] = useState(template?.name ?? "");
  const [body, setBody] = useState(template?.body ?? "");
  const [title, setTitle] = useState(template?.title ?? "");
  const [category, setCategory] = useState(template?.category ?? "general");
  const readOnly = !!template?.isGlobal;

  React.useEffect(() => {
    if (visible) {
      setName(template?.name ?? "");
      setBody(template?.body ?? "");
      setTitle(template?.title ?? "");
      setCategory(template?.category ?? "general");
    }
  }, [visible, template]);

  const saveM = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        name: name.trim(), body, category: category || "general",
      };
      if (channel === "push") payload.title = title || name.trim();
      if (template && !template.isGlobal) {
        return customFetch(`/api/restaurants/${restaurantId}/growth/templates/${channel}/${template.id}`, {
          method: "PATCH", body: JSON.stringify(payload),
        });
      }
      return customFetch(`/api/restaurants/${restaurantId}/growth/templates/${channel}`, {
        method: "POST", body: JSON.stringify(payload),
      });
    },
    onSuccess: () => { Alert.alert("Saved"); onSaved(); },
    onError: (err) => Alert.alert("Failed", err instanceof Error ? err.message : "Could not save"),
  });

  const deleteM = useMutation({
    mutationFn: () => customFetch(`/api/restaurants/${restaurantId}/growth/templates/${channel}/${template!.id}`, { method: "DELETE" }),
    onSuccess: () => { Alert.alert("Deleted"); onSaved(); },
    onError: (err) => Alert.alert("Failed", err instanceof Error ? err.message : "Could not delete"),
  });

  return (
    <AppBottomSheet visible={visible} onClose={onClose} title={template ? "Template" : "New template"}>
      {readOnly ? (
        <AppCard padding={10}>
          <AppText variant="small" color="mutedForeground">
            This is a built-in template and cannot be edited. Use it as inspiration to write your own.
          </AppText>
        </AppCard>
      ) : null}

      <AppInput label="Name" value={name} onChangeText={setName} editable={!readOnly} placeholder="Welcome offer" />
      <AppInput label="Category" value={category} onChangeText={setCategory} editable={!readOnly} placeholder="general / promo / reminder" />
      {channel === "push" ? (
        <AppInput label="Title" value={title} onChangeText={setTitle} editable={!readOnly} placeholder="20% off today" />
      ) : null}
      <AppInput
        label="Body"
        value={body}
        onChangeText={setBody}
        editable={!readOnly}
        multiline
        numberOfLines={6}
        placeholder="Hi {{name}}, enjoy our weekend special!"
      />
      <AppText variant="micro" color="mutedForeground">
        Use {"{{name}}"} or {"{{coupon_code}}"} placeholders — they are filled when the campaign sends.
      </AppText>

      {!readOnly ? (
        <AppButton
          label="Save"
          loading={saveM.isPending}
          disabled={!name.trim() || !body.trim()}
          onPress={() => saveM.mutate()}
        />
      ) : null}
      {template && !template.isGlobal ? (
        <AppButton
          label="Delete"
          variant="outline"
          loading={deleteM.isPending}
          onPress={() => deleteM.mutate()}
        />
      ) : null}
    </AppBottomSheet>
  );
}
