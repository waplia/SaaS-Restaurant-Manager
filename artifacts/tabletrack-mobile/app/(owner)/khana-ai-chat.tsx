import React, { useEffect, useRef, useState } from "react";
import { View, Text, ScrollView, StyleSheet, TextInput, Pressable, KeyboardAvoidingView, Platform, ActivityIndicator } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { SectionHeader } from "@/components/SectionHeader";
import { AICreditChip } from "@/components/AICreditChip";
import { BRAND } from "@/constants/brand";

type Msg = { role: "user" | "assistant"; content: string };

export default function KhanaAIChatScreen() {
  const colors = useColors();
  const { restaurantId } = useAuth();
  const [messages, setMessages] = useState<Msg[]>([
    { role: "assistant", content: "Hi! Ask me about today's sales, low stock, top items, staff, customers — anything." },
  ]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<ScrollView>(null);

  const send = useMutation({
    mutationFn: async (text: string) => {
      return customFetch<{ reply?: string; message?: string; content?: string }>(
        `/restaurants/${restaurantId}/dashboard-chat/message`,
        { method: "POST", body: JSON.stringify({ message: text }) },
      );
    },
    onSuccess: (data) => {
      const reply = data.reply ?? data.message ?? data.content ?? "Sorry, I couldn't generate a response.";
      setMessages(m => [...m, { role: "assistant", content: reply }]);
    },
    onError: (e: unknown) => {
      setMessages(m => [...m, { role: "assistant", content: `Error: ${e instanceof Error ? e.message : "Failed to reach Khana AI"}` }]);
    },
  });

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, [messages, send.isPending]);

  const handleSend = () => {
    const t = input.trim();
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
      <SectionHeader title="Khana AI" subtitle="Ask anything about your restaurant" showBack right={<AICreditChip compact />} />
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
                onPress={() => { setInput(s); }}
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
          onSubmitEditing={handleSend}
          editable={!send.isPending}
        />
        <Pressable
          onPress={handleSend}
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
