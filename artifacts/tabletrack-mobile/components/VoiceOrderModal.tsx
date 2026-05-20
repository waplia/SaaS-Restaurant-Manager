import React, { useEffect, useRef, useState } from "react";
import {
  Modal, View, Text, TextInput, Pressable, ScrollView,
  ActivityIndicator, StyleSheet, Alert, Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as SecureStore from "@/lib/secureStorage";
import { useColors } from "@/hooks/useColors";
import { getApiBaseUrl } from "@/lib/apiBaseUrl";
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";

// Web Speech API typings (only used on web).
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

interface ParsedItem {
  menuItemId: number | null;
  nameGuess: string;
  quantity: number;
  notes: string | null;
  confidence: number;
}
interface VoiceParseResponse {
  transcript: string;
  language: string;
  tableId: number | null;
  tableLabel: string | null;
  items: ParsedItem[];
  unresolved: Array<{ nameGuess: string; quantity: number; notes: string | null }>;
  notes: string | null;
}

export interface VoiceOrderResult {
  items: Array<{ menuItemId: number; quantity: number; notes?: string }>;
  notes?: string;
}

interface MenuItemLite {
  id: number;
  name: string;
  price: string | number;
}

interface Props {
  visible: boolean;
  restaurantId: number;
  tableId: number;
  menuItems: MenuItemLite[];
  onClose: () => void;
  onConfirm: (result: VoiceOrderResult) => Promise<void> | void;
}

export function VoiceOrderModal({ visible, restaurantId, tableId, menuItems, onClose, onConfirm }: Props) {
  const colors = useColors();
  const [transcript, setTranscript] = useState("");
  const [parsing, setParsing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [parsed, setParsed] = useState<VoiceParseResponse | null>(null);
  const [items, setItems] = useState<ParsedItem[]>([]);
  const [pickerForIdx, setPickerForIdx] = useState<number | null>(null);
  const [pickerSearch, setPickerSearch] = useState("");
  const [listening, setListening] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const recognitionRef = useRef<InstanceType<SRConstructor> | null>(null);
  const SR = getSpeechRecognition();
  const isNative = Platform.OS !== "web";
  const nativeRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const micSupported = isNative || !!SR;

  useEffect(() => {
    return () => {
      try { recognitionRef.current?.stop(); } catch {}
    };
  }, []);

  const startWebRecognition = () => {
    if (!SR) return;
    try {
      const rec = new SR();
      rec.lang = "en-IN";
      rec.interimResults = true;
      rec.continuous = true;
      let finalText = transcript ? transcript + " " : "";
      rec.onresult = (e) => {
        let interim = "";
        for (let i = 0; i < e.results.length; i++) {
          const res = e.results[i] as ArrayLike<{ transcript: string }> & { isFinal?: boolean; 0: { transcript: string } };
          const chunk = res[0]?.transcript ?? "";
          if ((res as { isFinal?: boolean }).isFinal) finalText += chunk + " ";
          else interim = chunk;
        }
        setTranscript((finalText + interim).trim());
      };
      rec.onerror = (e) => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          setMicError("Microphone permission was denied. Enable it in your browser settings and try again.");
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

  const startNativeRecording = async () => {
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setMicError("Microphone permission was denied. Enable it in your device settings and try again.");
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
      const resp = await fetch(`${baseUrl}/api/restaurants/${restaurantId}/voice-orders/transcribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({ audioBase64: base64, mimeType, language: "en" }),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({} as { error?: string }));
        throw new Error((body as { error?: string }).error ?? `HTTP ${resp.status}`);
      }
      const data = (await resp.json()) as { transcript: string };
      setTranscript((prev) => (prev ? prev + " " : "") + (data.transcript ?? "").trim());
    } catch (e) {
      setMicError((e as Error).message);
    } finally {
      setTranscribing(false);
    }
  };

  const toggleListening = () => {
    setMicError(null);
    if (isNative) {
      if (listening) { void stopNativeRecordingAndTranscribe(); }
      else { void startNativeRecording(); }
      return;
    }
    if (!SR) {
      setMicError("Your browser does not support voice input. Try Chrome on Android or desktop.");
      return;
    }
    if (listening) {
      try { recognitionRef.current?.stop(); } catch {}
      setListening(false);
      return;
    }
    startWebRecognition();
  };

  const reset = () => {
    setTranscript("");
    setParsed(null);
    setItems([]);
    setParsing(false);
    setSubmitting(false);
    setMicError(null);
    try { recognitionRef.current?.stop(); } catch {}
    setListening(false);
  };
  const handleClose = () => { reset(); onClose(); };

  const handleParse = async () => {
    const text = transcript.trim();
    if (!text) {
      Alert.alert("Empty", "Tap the keyboard mic and dictate the order, or type it.");
      return;
    }
    setParsing(true);
    try {
      const baseUrl = `${getApiBaseUrl()}`;
      const token = await SecureStore.getItem("accessToken");
      const resp = await fetch(`${baseUrl}/api/restaurants/${restaurantId}/voice-orders/parse`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({ transcript: text, language: "en-IN", tableId }),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({} as { error?: string }));
        throw new Error((body as { error?: string }).error ?? `HTTP ${resp.status}`);
      }
      const data = (await resp.json()) as VoiceParseResponse;
      setParsed(data);
      setItems(data.items);
    } catch (e) {
      Alert.alert("Could not parse", (e as Error).message);
    } finally {
      setParsing(false);
    }
  };

  const setItemMenuId = (idx: number, id: number) => {
    setItems((p) => p.map((it, i) => i === idx
      ? { ...it, menuItemId: id, confidence: 1 }
      : it));
    setPickerForIdx(null);
    setPickerSearch("");
  };
  const setItemNotes = (idx: number, notes: string) => {
    setItems((p) => p.map((it, i) => i === idx ? { ...it, notes } : it));
  };
  const addUnresolvedAsItem = (u: { nameGuess: string; quantity: number; notes: string | null }) => {
    setItems((p) => [...p, { menuItemId: null, nameGuess: u.nameGuess, quantity: u.quantity, notes: u.notes, confidence: 0 }]);
    setParsed((p) => p ? { ...p, unresolved: p.unresolved.filter((x) => x !== u) } : p);
  };

  const updateQty = (idx: number, delta: number) => {
    setItems((p) => p.map((it, i) => i === idx
      ? { ...it, quantity: Math.max(1, Math.min(50, it.quantity + delta)) }
      : it));
  };
  const removeItem = (idx: number) => setItems((p) => p.filter((_, i) => i !== idx));

  const valid = items.filter((it) => it.menuItemId != null);

  const handleConfirm = async () => {
    if (valid.length === 0) {
      Alert.alert("Nothing matched", "No menu items were resolved. Try again with different words.");
      return;
    }
    setSubmitting(true);
    try {
      await onConfirm({
        items: valid.map((it) => ({
          menuItemId: it.menuItemId as number,
          quantity: it.quantity,
          notes: it.notes ?? undefined,
        })),
        notes: parsed?.notes ?? undefined,
      });
      handleClose();
    } catch (e) {
      Alert.alert("Could not send order", (e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.text }]}>Voice order</Text>
          <Pressable onPress={handleClose} hitSlop={10}>
            <Ionicons name="close" size={24} color={colors.text} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={[styles.label, { color: colors.mutedForeground }]}>
            {micSupported
              ? "Tap the mic and speak your order. English/Hindi/Hinglish supported."
              : "Your browser does not support in-page voice — type the order instead."}
          </Text>

          <Pressable
            onPress={toggleListening}
            disabled={transcribing}
            style={[
              styles.micBtn,
              {
                backgroundColor: listening ? "#ef4444" : colors.primary,
                opacity: micSupported && !transcribing ? 1 : 0.5,
              },
            ]}
          >
            {transcribing ? (
              <>
                <ActivityIndicator color="#fff" />
                <Text style={styles.micBtnText}>Transcribing…</Text>
              </>
            ) : (
              <>
                <Ionicons name={listening ? "stop" : "mic"} size={22} color="#fff" />
                <Text style={styles.micBtnText}>
                  {listening
                    ? (isNative ? "Recording… tap to stop" : "Listening… tap to stop")
                    : micSupported ? "Tap to speak" : "Voice input unavailable"}
                </Text>
              </>
            )}
          </Pressable>
          {micError ? (
            <Text style={{ color: colors.destructive, fontSize: 12 }}>{micError}</Text>
          ) : null}

          <TextInput
            value={transcript}
            onChangeText={setTranscript}
            multiline
            numberOfLines={4}
            placeholder='e.g. "do butter naan, ek paneer tikka, teen lassi"'
            placeholderTextColor={colors.mutedForeground}
            style={[styles.textArea, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]}
          />
          <Pressable
            onPress={handleParse}
            disabled={parsing || !transcript.trim()}
            style={[styles.parseBtn, { backgroundColor: colors.primary, opacity: parsing || !transcript.trim() ? 0.5 : 1 }]}
          >
            {parsing
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.parseBtnText}>Parse with AI</Text>}
          </Pressable>

          {parsed && (
            <View style={{ marginTop: 16, gap: 10 }}>
              {items.length === 0 && (
                <Text style={[styles.label, { color: colors.mutedForeground, fontStyle: "italic" }]}>
                  No items extracted. Edit the transcript and try again.
                </Text>
              )}
              {items.map((it, idx) => {
                const lowConf = (it.confidence ?? 0) < 0.7;
                return (
                  <View
                    key={idx}
                    style={[
                      styles.itemRow,
                      { borderColor: lowConf ? "#f59e0b" : colors.border, backgroundColor: colors.card, flexDirection: "column", alignItems: "stretch", gap: 6 },
                    ]}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[styles.itemName, { color: colors.text }]} numberOfLines={1}>
                          Heard: {it.nameGuess}
                        </Text>
                        {it.menuItemId == null && (
                          <Text style={{ color: "#f59e0b", fontSize: 11 }}>Tap "Pick item" to match</Text>
                        )}
                      </View>
                      <Pressable onPress={() => updateQty(idx, -1)} style={[styles.qtyBtn, { borderColor: colors.border }]}>
                        <Ionicons name="remove" size={16} color={colors.text} />
                      </Pressable>
                      <Text style={{ color: colors.text, fontWeight: "600", width: 22, textAlign: "center" }}>
                        {it.quantity}
                      </Text>
                      <Pressable onPress={() => updateQty(idx, 1)} style={[styles.qtyBtn, { borderColor: colors.border }]}>
                        <Ionicons name="add" size={16} color={colors.text} />
                      </Pressable>
                      <Pressable onPress={() => removeItem(idx)} style={{ marginLeft: 4 }} hitSlop={6}>
                        <Ionicons name="trash-outline" size={18} color="#ef4444" />
                      </Pressable>
                    </View>
                    <Pressable
                      onPress={() => { setPickerForIdx(idx); setPickerSearch(""); }}
                      style={{
                        borderWidth: 1, borderColor: colors.border, borderRadius: 8,
                        paddingVertical: 6, paddingHorizontal: 10, alignSelf: "flex-start",
                      }}
                    >
                      <Text style={{ color: colors.text, fontSize: 12 }}>
                        {it.menuItemId
                          ? `→ ${menuItems.find((m) => m.id === it.menuItemId)?.name ?? `Item #${it.menuItemId}`}`
                          : "Pick item from menu…"}
                      </Text>
                    </Pressable>
                    <TextInput
                      value={it.notes ?? ""}
                      onChangeText={(t) => setItemNotes(idx, t)}
                      placeholder="Add note (optional)"
                      placeholderTextColor={colors.mutedForeground}
                      style={{
                        borderWidth: 1, borderColor: colors.border, borderRadius: 8,
                        paddingHorizontal: 10, paddingVertical: 6, fontSize: 12, color: colors.text,
                      }}
                    />
                  </View>
                );
              })}
              {parsed.unresolved.length > 0 && (
                <View style={[styles.unresolved, { borderColor: "#f59e0b" }]}>
                  <Text style={{ color: "#92400e", fontWeight: "600", fontSize: 12, marginBottom: 4 }}>
                    Couldn’t match these
                  </Text>
                  {parsed.unresolved.map((u, i) => (
                    <Pressable
                      key={i}
                      onPress={() => addUnresolvedAsItem(u)}
                      style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4 }}
                    >
                      <Ionicons name="add-circle-outline" size={14} color="#92400e" />
                      <Text style={{ color: "#92400e", fontSize: 12 }}>
                        {u.quantity}× {u.nameGuess}{u.notes ? ` — ${u.notes}` : ""} (tap to resolve)
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          )}
        </ScrollView>

        <View style={[styles.footer, { borderTopColor: colors.border }]}>
          <Pressable
            onPress={handleClose}
            disabled={submitting}
            style={[styles.footerBtn, { borderColor: colors.border }]}
          >
            <Text style={{ color: colors.text, fontWeight: "600" }}>Cancel</Text>
          </Pressable>
          <Pressable
            onPress={handleConfirm}
            disabled={!parsed || valid.length === 0 || submitting}
            style={[
              styles.footerBtn,
              { backgroundColor: colors.primary, opacity: !parsed || valid.length === 0 || submitting ? 0.5 : 1, borderColor: colors.primary },
            ]}
          >
            {submitting
              ? <ActivityIndicator color="#fff" />
              : <Text style={{ color: "#fff", fontWeight: "700" }}>Add {valid.length} item{valid.length === 1 ? "" : "s"}</Text>}
          </Pressable>
        </View>

        <Modal
          visible={pickerForIdx !== null}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setPickerForIdx(null)}
        >
          <View style={[styles.container, { backgroundColor: colors.background }]}>
            <View style={[styles.header, { borderBottomColor: colors.border }]}>
              <Text style={[styles.title, { color: colors.text }]}>Pick menu item</Text>
              <Pressable onPress={() => setPickerForIdx(null)} hitSlop={10}>
                <Ionicons name="close" size={24} color={colors.text} />
              </Pressable>
            </View>
            <View style={{ padding: 12 }}>
              <TextInput
                value={pickerSearch}
                onChangeText={setPickerSearch}
                placeholder="Search…"
                placeholderTextColor={colors.mutedForeground}
                style={{
                  borderWidth: 1, borderColor: colors.border, borderRadius: 8,
                  paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, color: colors.text,
                }}
                autoFocus
              />
            </View>
            <ScrollView contentContainerStyle={{ padding: 12, gap: 6 }}>
              {menuItems
                .filter((m) => m.name.toLowerCase().includes(pickerSearch.trim().toLowerCase()))
                .slice(0, 80)
                .map((m) => (
                  <Pressable
                    key={m.id}
                    onPress={() => pickerForIdx != null && setItemMenuId(pickerForIdx, m.id)}
                    style={{
                      paddingVertical: 10, paddingHorizontal: 12,
                      borderWidth: 1, borderColor: colors.border, borderRadius: 8,
                      backgroundColor: colors.card,
                      flexDirection: "row", justifyContent: "space-between", alignItems: "center",
                    }}
                  >
                    <Text style={{ color: colors.text, fontSize: 14, flex: 1 }} numberOfLines={1}>
                      {m.name}
                    </Text>
                    <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>₹{Number(m.price).toFixed(0)}</Text>
                  </Pressable>
                ))}
            </ScrollView>
          </View>
        </Modal>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 17, fontWeight: "700" },
  body: { padding: 16, gap: 10 },
  label: { fontSize: 13, lineHeight: 18 },
  textArea: {
    borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 15,
    minHeight: 90, textAlignVertical: "top",
  },
  parseBtn: {
    paddingVertical: 12, borderRadius: 10, alignItems: "center", justifyContent: "center",
  },
  parseBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  micBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 10, paddingVertical: 14, borderRadius: 12,
  },
  micBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  itemRow: {
    flexDirection: "row", alignItems: "center", gap: 6,
    borderWidth: 1, borderRadius: 10, padding: 10,
  },
  itemName: { fontSize: 14, fontWeight: "600" },
  qtyBtn: {
    width: 28, height: 28, borderRadius: 6, borderWidth: 1,
    alignItems: "center", justifyContent: "center",
  },
  unresolved: {
    borderWidth: 1, borderRadius: 10, padding: 10,
    backgroundColor: Platform.OS === "ios" ? "#fef3c7" : "#fef3c7",
  },
  footer: {
    flexDirection: "row", gap: 10, padding: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 10,
    borderWidth: 1, alignItems: "center", justifyContent: "center",
  },
});
