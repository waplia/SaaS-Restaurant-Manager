import React, { useEffect, useRef, useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, TextInput, Pressable,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from "react-native";
import { useMutation } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { SectionHeader } from "@/components/SectionHeader";
import { AICreditChip } from "@/components/AICreditChip";
import { BRAND } from "@/constants/brand";

type Msg = { role: "user" | "assistant"; content: string };

// Conversation state is persisted per restaurant so the chat survives
// remounts, navigation away, and full app restarts.
const storageKey = (rid: number | null | undefined) => `khana-ai-chat:${rid ?? "anon"}`;
type PersistedChat = { conversationId: number | null; messages: Msg[] };

type ChatResponse = {
  conversationId: number;
  message: { content: string };
  creditsCharged?: number;
};

export default function KhanaAIChatScreen() {
  const colors = useColors();
  const { restaurantId } = useAuth();
  const greeting: Msg = { role: "assistant", content: "Hi! Ask me about today's sales, low stock, top items, staff, customers — anything." };
  const [messages, setMessages] = useState<Msg[]>([greeting]);
  const [input, setInput] = useState("");
  // Conversation id is returned by the server on the first message and reused
  // on every subsequent send so multi-turn context is preserved.
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  // Restore the prior conversation on mount.
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(storageKey(restaurantId)).then(raw => {
      if (cancelled) return;
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as PersistedChat;
          if (Array.isArray(parsed.messages) && parsed.messages.length > 0) {
            setMessages(parsed.messages);
          }
          if (typeof parsed.conversationId === "number") {
            setConversationId(parsed.conversationId);
          }
        } catch { /* ignore corrupted state */ }
      }
      setHydrated(true);
    }).catch(() => setHydrated(true));
    return () => { cancelled = true; };
  }, [restaurantId]);

  // Persist on every change once hydrated.
  useEffect(() => {
    if (!hydrated) return;
    const payload: PersistedChat = { conversationId, messages };
    AsyncStorage.setItem(storageKey(restaurantId), JSON.stringify(payload)).catch(() => {});
  }, [conversationId, messages, hydrated, restaurantId]);

  const resetChat = () => {
    setMessages([greeting]);
    setConversationId(null);
    AsyncStorage.removeItem(storageKey(restaurantId)).catch(() => {});
  };

  const send = useMutation({
    mutationFn: async (text: string) => {
      // customFetch does NOT auto-prepend `/api`; every call must include
      // the prefix explicitly. The dashboard-chat router is mounted under
      // `/api/restaurants/:id/dashboard-chat/messages`.
      return customFetch<ChatResponse>(
        `/api/restaurants/${restaurantId}/dashboard-chat/messages`,
        {
          method: "POST",
          body: JSON.stringify({
            message: text,
            conversationId: conversationId ?? undefined,
          }),
        },
      );
    },
    onSuccess: (data) => {
      if (data.conversationId && conversationId == null) {
        setConversationId(data.conversationId);
      }
      const reply = data?.message?.content ?? "Sorry, I couldn't generate a response.";
      setMessages(m => [...m, { role: "assistant", content: reply }]);
    },
    onError: (e: unknown) => {
      setMessages(m => [...m, {
        role: "assistant",
        content: `Error: ${e instanceof Error ? e.message : "Failed to reach Khana AI"}`,
      }]);
    },
  });

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, [messages, send.isPending]);

  const sendText = (text: string) => {
    const t = text.trim();
    if (!t || send.isPending) return;
    setMessages(m => [...m, { role: "user", content: t }]);
    setInput("");
    send.mutate(t);
  };

  const suggestions = [
    "What were today's sales?",
    "Which items sold best this week?",
    "Anyone absent today?",
    "What's running low in stock?",
  ];

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <SectionHeader
        title="Khana AI"
        subtitle="Ask anything about your restaurant"
        showBack
        right={
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            {messages.length > 1 || conversationId != null ? (
              <Pressable hitSlop={10} onPress={resetChat}>
                <Ionicons name="refresh" size={18} color={colors.mutedForeground} />
              </Pressable>
            ) : null}
            <AICreditChip compact />
          </View>
        }
      />
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 16 }}
      >
        {messages.map((m, i) => (
          <View
            key={i}
            style={[
              styles.bubble,
              m.role === "user"
                ? { alignSelf: "flex-end", backgroundColor: colors.primary }
                : { alignSelf: "flex-start", backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 },
            ]}
          >
            <Text style={[styles.bubbleText, { color: m.role === "user" ? "#fff" : colors.foreground }]}>{m.content}</Text>
          </View>
        ))}
        {send.isPending ? (
          <View style={[styles.bubble, { alignSelf: "flex-start", backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, flexDirection: "row", gap: 8, alignItems: "center" }]}>
            <ActivityIndicator size="small" color={BRAND.ai} />
            <Text style={[styles.bubbleText, { color: colors.mutedForeground }]}>Thinking…</Text>
          </View>
        ) : null}
        {messages.length === 1 ? (
          <View style={{ gap: 6, marginTop: 8 }}>
            {suggestions.map(s => (
              <Pressable
                key={s}
                // Tapping a suggestion now sends it immediately — previously
                // it only populated the input box and required a second tap.
                onPress={() => sendText(s)}
                disabled={send.isPending}
                style={({ pressed }) => [styles.sugg, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
              >
                <Ionicons name="bulb-outline" size={14} color={BRAND.ai} />
                <Text style={[styles.suggText, { color: colors.mutedForeground }]}>{s}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </ScrollView>
      <View style={[styles.inputRow, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="Ask Khana AI…"
          placeholderTextColor={colors.mutedForeground}
          style={[styles.input, { color: colors.foreground, backgroundColor: colors.muted }]}
          onSubmitEditing={() => sendText(input)}
          editable={!send.isPending}
        />
        <Pressable
          onPress={() => sendText(input)}
          disabled={!input.trim() || send.isPending}
          style={({ pressed }) => [
            styles.sendBtn,
            { backgroundColor: BRAND.ai, opacity: !input.trim() || send.isPending ? 0.4 : pressed ? 0.85 : 1 },
          ]}
        >
          <Ionicons name="send" size={16} color="#fff" />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  bubble: { maxWidth: "85%", paddingHorizontal: 12, paddingVertical: 9, borderRadius: 14 },
  bubbleText: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  sugg: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, borderWidth: 1 },
  suggText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, paddingBottom: Platform.OS === "ios" ? 28 : 12, borderTopWidth: 1 },
  input: { flex: 1, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 22, fontFamily: "Inter_400Regular", fontSize: 14 },
  sendBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
});
