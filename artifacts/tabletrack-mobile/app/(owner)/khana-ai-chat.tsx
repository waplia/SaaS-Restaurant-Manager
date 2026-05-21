import React, { useEffect, useRef, useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, TextInput, Pressable,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from "react-native";
import { useMutation } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "@/lib/secureStorage";
import { getApiBaseUrl } from "@/lib/apiBaseUrl";
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder } from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { SectionHeader } from "@/components/SectionHeader";
import { AICreditChip } from "@/components/AICreditChip";
import { BRAND } from "@/constants/brand";

// Web SpeechRecognition shim (Chrome/Edge/Safari).
type SRConstructor = new () => {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
  onerror: (e: { error: string }) => void;
  onend: () => void;
  start: () => void;
  stop: () => void;
};
function getSpeechRecognition(): SRConstructor | null {
  if (Platform.OS !== "web" || typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SRConstructor; webkitSpeechRecognition?: SRConstructor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

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
  const inputRef = useRef<TextInput>(null);

  // Voice input state. On native we record m4a via expo-audio and POST it
  // to the existing /voice-orders/transcribe endpoint (gpt-4o-mini-transcribe).
  // On web we use the browser's SpeechRecognition API (no server round-trip).
  const isNative = Platform.OS !== "web";
  const SR = getSpeechRecognition();
  const nativeRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recognitionRef = useRef<InstanceType<SRConstructor> | null>(null);
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const micSupported = isNative || !!SR;

  // Stop any in-flight recording on unmount so we don't leak the mic.
  useEffect(() => () => { try { recognitionRef.current?.stop(); } catch { /* ignore */ } }, []);

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

  const appendToInput = (chunk: string) => {
    const t = chunk.trim();
    if (!t) return;
    setInput(prev => (prev ? prev.trim() + " " : "") + t);
  };

  // ---- Web SpeechRecognition (free, in-browser) ----
  const startWebRecognition = () => {
    if (!SR) return;
    try {
      const rec = new SR();
      rec.lang = "en-IN";
      rec.interimResults = true;
      rec.continuous = true;
      let finalText = "";
      rec.onresult = (e) => {
        let interim = "";
        finalText = "";
        for (let i = 0; i < e.results.length; i++) {
          const res = e.results[i] as ArrayLike<{ transcript: string }> & { isFinal?: boolean; 0: { transcript: string } };
          const chunk = res[0]?.transcript ?? "";
          if ((res as { isFinal?: boolean }).isFinal) finalText += chunk + " ";
          else interim = chunk;
        }
        // Replace the trailing draft each tick so the input mirrors what the
        // user is currently saying without piling duplicate words.
        setInput((finalText + interim).trim());
      };
      rec.onerror = (e) => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          setMicError("Microphone permission was denied. Enable it in your browser settings.");
        } else if (e.error === "no-speech") {
          setMicError("Didn't catch anything — try again.");
        } else {
          setMicError(`Voice error: ${e.error}`);
        }
        setListening(false);
      };
      rec.onend = () => setListening(false);
      recognitionRef.current = rec;
      rec.start();
      setListening(true);
    } catch (err) {
      setMicError((err as Error).message);
      setListening(false);
    }
  };

  // ---- Native recording (expo-audio) + server transcription ----
  const startNativeRecording = async () => {
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setMicError("Microphone permission was denied. Enable it in your device settings.");
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await nativeRecorder.prepareToRecordAsync();
      nativeRecorder.record();
      setListening(true);
    } catch (e) {
      setMicError(`Could not start recording: ${(e as Error).message}`);
      setListening(false);
    }
  };

  const stopNativeRecordingAndTranscribe = async () => {
    setListening(false);
    setTranscribing(true);
    try {
      await nativeRecorder.stop();
      const uri = nativeRecorder.uri;
      if (!uri) throw new Error("No recording captured");
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      const mimeType = uri.endsWith(".wav") ? "audio/wav" : uri.endsWith(".webm") ? "audio/webm" : "audio/m4a";
      const baseUrl = getApiBaseUrl();
      const token = await SecureStore.getItem("accessToken");
      // We reuse the existing /voice-orders/transcribe endpoint — it doesn't
      // require an active table and the OpenAI Whisper call is identical for
      // any utterance. No AI credit is charged for transcription (only for
      // the parse step, which Khana AI does not use).
      const resp = await fetch(`${baseUrl}/api/restaurants/${restaurantId}/voice-orders/transcribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({ audioBase64: base64, mimeType, language: "" }),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({} as { error?: string }));
        throw new Error((body as { error?: string }).error ?? `HTTP ${resp.status}`);
      }
      const data = (await resp.json()) as { transcript: string };
      appendToInput(data.transcript ?? "");
    } catch (e) {
      setMicError((e as Error).message);
    } finally {
      setTranscribing(false);
    }
  };

  const toggleMic = () => {
    setMicError(null);
    if (send.isPending || transcribing) return;
    if (isNative) {
      if (listening) void stopNativeRecordingAndTranscribe();
      else void startNativeRecording();
      return;
    }
    if (!SR) {
      setMicError("This browser does not support voice input. Try Chrome on Android or desktop.");
      return;
    }
    if (listening) {
      try { recognitionRef.current?.stop(); } catch { /* ignore */ }
      setListening(false);
      return;
    }
    startWebRecognition();
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
      {micError ? (
        <View style={{ paddingHorizontal: 14, paddingTop: 4 }}>
          <Text style={{ color: "#dc2626", fontSize: 11, fontFamily: "Inter_500Medium" }}>{micError}</Text>
        </View>
      ) : null}
      <View style={[styles.inputRow, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
        <TextInput
          ref={inputRef}
          value={input}
          onChangeText={setInput}
          placeholder={listening ? "Listening…" : transcribing ? "Transcribing…" : "Ask Khana AI… or tap the mic"}
          placeholderTextColor={colors.mutedForeground}
          style={[styles.input, { color: colors.foreground, backgroundColor: colors.muted }]}
          onSubmitEditing={() => sendText(input)}
          editable={!send.isPending}
          multiline
        />
        {/* Real mic button: native uses expo-audio + server Whisper; web uses
            in-browser SpeechRecognition. Permissions are requested on first
            tap and the button turns red while recording. */}
        <Pressable
          onPress={toggleMic}
          disabled={send.isPending || transcribing || !micSupported}
          style={({ pressed }) => [
            styles.micBtn,
            {
              backgroundColor: listening ? "#dc2626" : colors.muted,
              opacity: (!micSupported || send.isPending) ? 0.4 : transcribing ? 0.7 : pressed ? 0.7 : 1,
            },
          ]}
          accessibilityLabel={listening ? "Stop recording" : "Start voice input"}
        >
          {transcribing ? (
            <ActivityIndicator size="small" color={colors.foreground} />
          ) : (
            <Ionicons
              name={listening ? "stop" : "mic-outline"}
              size={18}
              color={listening ? "#fff" : colors.foreground}
            />
          )}
        </Pressable>
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
  input: { flex: 1, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 22, fontFamily: "Inter_400Regular", fontSize: 14, maxHeight: 120, minHeight: 40 },
  micBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  sendBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
});
