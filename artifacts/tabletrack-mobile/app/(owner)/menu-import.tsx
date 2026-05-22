import React, { useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator,
  Alert, TextInput, Platform, Image,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { useQueryClient } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { getApiBaseUrl } from "@/lib/apiBaseUrl";
import { SectionHeader } from "@/components/SectionHeader";
import { BRAND } from "@/constants/brand";

const STORAGE_MAX_BYTES = 10 * 1024 * 1024;

type Source = "image" | "pdf" | "text";
type Status = "idle" | "uploading" | "starting" | "processing" | "saving" | "done" | "error";
type Picked = { uri: string; name: string; mime: string; size: number };

type ImportRow = {
  id: number;
  status: string;
  needsReview?: boolean;
  duplicateMatchId?: number | null;
  libraryImageUrl?: string | null;
  savedImageUrl?: string | null;
};
type ImportDetail = {
  import: { id: number; status: string; totalRows: number; errorMessage?: string | null };
  items: ImportRow[];
};

export default function MenuImportScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const { restaurantId, accessToken } = useAuth();
  const qc = useQueryClient();

  const [source, setSource] = useState<Source>("image");
  const [picked, setPicked] = useState<Picked | null>(null);
  const [text, setText] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [detail, setDetail] = useState<ImportDetail | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => () => {
    cancelledRef.current = true;
    if (pollRef.current) clearTimeout(pollRef.current);
  }, []);

  const api = {
    async call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
      const r = await fetch(`${getApiBaseUrl()}/api${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${r.status})`);
      return data as T;
    },
  };

  async function pickPhoto() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return Alert.alert("Permission needed", "Allow photo access to attach a menu photo.");
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.85,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const a = result.assets[0];
    const blob = await (await fetch(a.uri)).blob();
    if (blob.size > STORAGE_MAX_BYTES) return Alert.alert("Photo too large", "Max 10 MB.");
    setSource("image");
    setPicked({ uri: a.uri, name: a.fileName ?? `menu-${Date.now()}.jpg`, mime: a.mimeType ?? "image/jpeg", size: blob.size });
  }

  async function pickPdf() {
    const result = await DocumentPicker.getDocumentAsync({ type: "application/pdf", multiple: false, copyToCacheDirectory: true });
    if (result.canceled || !result.assets?.[0]) return;
    const a = result.assets[0];
    const size = a.size ?? (await (await fetch(a.uri)).blob()).size;
    if (size > STORAGE_MAX_BYTES) return Alert.alert("PDF too large", "Max 10 MB.");
    setSource("pdf");
    setPicked({ uri: a.uri, name: a.name || `menu-${Date.now()}.pdf`, mime: a.mimeType || "application/pdf", size });
  }

  async function uploadPicked(): Promise<string> {
    if (!picked) throw new Error("No file picked");
    const presign = await api.call<{ uploadURL: string; objectPath: string }>(
      "POST", `/restaurants/${restaurantId}/storage/uploads/request-url`,
      { name: picked.name, size: picked.size, contentType: picked.mime },
    );
    const blob = await (await fetch(picked.uri)).blob();
    const put = await fetch(presign.uploadURL, { method: "PUT", headers: { "Content-Type": picked.mime }, body: blob });
    if (!put.ok) throw new Error(`Upload failed (${put.status})`);
    await api.call("POST", `/restaurants/${restaurantId}/storage/uploads/finalize`, { objectPath: presign.objectPath });
    return presign.objectPath;
  }

  async function pollDetail(id: number) {
    try {
      const d = await api.call<ImportDetail>("GET", `/restaurants/${restaurantId}/ai/menu-import/imports/${id}`);
      if (cancelledRef.current) return;
      setDetail(d);
      const s = d.import.status;
      if (s === "pending" || s === "processing") {
        setStatus("processing");
        pollRef.current = setTimeout(() => { if (!cancelledRef.current) void pollDetail(id); }, 2500);
        return;
      }
      if (s === "failed") { setStatus("error"); setError(d.import.errorMessage ?? "Import failed."); return; }
      await autoSave(id, d);
    } catch (e) {
      if (cancelledRef.current) return;
      setStatus("error"); setError(e instanceof Error ? e.message : "Could not load import.");
    }
  }

  async function autoSave(importId: number, d: ImportDetail) {
    const rowIds = d.items.filter(r => r.status === "draft" && !r.needsReview && !r.duplicateMatchId).map(r => r.id);
    if (rowIds.length === 0) {
      setStatus("done");
      setSummary(d.import.totalRows === 0
        ? "AI couldn't find any items. Try a clearer photo or paste the text."
        : `All ${d.import.totalRows} extracted item${d.import.totalRows === 1 ? "" : "s"} need review on the web dashboard before saving.`);
      return;
    }
    setStatus("saving");
    try {
      const res = await api.call<{ savedCount: number; errors: { rowId: number; error: string }[] }>(
        "POST", `/restaurants/${restaurantId}/ai/menu-import/imports/${importId}/save`, { rowIds },
      );
      if (cancelledRef.current) return;
      setStatus("done");
      const flagged = d.import.totalRows - rowIds.length;
      setSummary(
        `Imported ${res.savedCount} item${res.savedCount === 1 ? "" : "s"}` +
        (flagged > 0 ? ` · ${flagged} need review on the web dashboard` : "") +
        (res.errors.length > 0 ? ` · ${res.errors.length} failed` : "")
      );
      qc.invalidateQueries({ queryKey: ["menu-items-mobile", restaurantId] });
      qc.invalidateQueries({ queryKey: ["menu-categories-mobile", restaurantId] });
    } catch (e) {
      if (cancelledRef.current) return;
      setStatus("error"); setError(e instanceof Error ? e.message : "Save failed.");
    }
  }

  async function start() {
    setError(null); setSummary(null);
    try {
      const body: Record<string, unknown> = { source };
      if (source === "image" || source === "pdf") {
        if (!picked) return Alert.alert(source === "pdf" ? "Pick a PDF" : "Pick a photo", "Choose a file first.");
        setStatus("uploading");
        body.fileName = picked.name;
        body.objectPath = await uploadPicked();
        if (source === "pdf") body.estimatedPages = Math.max(1, Math.ceil(picked.size / 100_000));
      } else {
        if (text.trim().length < 5) return Alert.alert("Paste menu text", "Paste a few items first.");
        if (text.length > 200_000) return Alert.alert("Too long", "Max 200,000 characters.");
        body.text = text;
      }
      setStatus("starting");
      const res = await api.call<{ id: number }>("POST", `/restaurants/${restaurantId}/ai/menu-import/start`, body);
      setStatus("processing");
      void pollDetail(res.id);
    } catch (e) {
      setStatus("error"); setError(e instanceof Error ? e.message : "Could not start import.");
    }
  }

  function reset() {
    cancelledRef.current = false;
    if (pollRef.current) clearTimeout(pollRef.current);
    setPicked(null); setText(""); setStatus("idle"); setError(null); setSummary(null); setDetail(null);
  }

  const isBusy = status === "uploading" || status === "starting" || status === "processing" || status === "saving";
  const statusLabel: Record<Status, string> = {
    idle: "", uploading: "Uploading…", starting: "Starting…",
    processing: "AI is reading your menu…", saving: "Saving items…",
    done: "Done", error: "Failed",
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SectionHeader title="Import menu with AI" showBack />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: isWeb ? 100 : insets.bottom + 100 }}>
        <View style={[styles.intro, { borderColor: BRAND.ai, backgroundColor: "#ede9fe" }]}>
          <Ionicons name="sparkles" size={22} color={BRAND.ai} />
          <Text style={[styles.introText, { color: "#4c1d95" }]}>
            Upload a menu photo, PDF or paste the text. AI will extract items, prices and categories,
            then save them straight to your menu.
          </Text>
        </View>

        <View style={styles.tabsRow}>
          {(["image", "pdf", "text"] as Source[]).map(s => (
            <Pressable
              key={s}
              onPress={() => { setSource(s); setPicked(null); }}
              disabled={isBusy}
              style={[
                styles.tab,
                {
                  borderColor: source === s ? colors.primary : colors.border,
                  backgroundColor: source === s ? colors.primary + "15" : colors.muted,
                },
              ]}
            >
              <Ionicons
                name={s === "image" ? "image-outline" : s === "pdf" ? "document-text-outline" : "create-outline"}
                size={16}
                color={source === s ? colors.primary : colors.mutedForeground}
              />
              <Text style={[styles.tabText, { color: source === s ? colors.primary : colors.mutedForeground }]}>
                {s === "image" ? "Photo" : s === "pdf" ? "PDF" : "Paste text"}
              </Text>
            </Pressable>
          ))}
        </View>

        {source === "image" || source === "pdf" ? (
          <View style={[styles.dropCard, { borderColor: colors.border, backgroundColor: colors.card }]}>
            <Ionicons
              name={source === "pdf" ? "document-text-outline" : "image-outline"}
              size={40} color={colors.mutedForeground}
            />
            <Text style={[styles.dropTitle, { color: colors.foreground }]}>
              {picked ? picked.name : source === "pdf" ? "Pick a PDF menu" : "Pick a menu photo"}
            </Text>
            <Text style={[styles.dropSub, { color: colors.mutedForeground }]}>
              {picked ? `${(picked.size / 1024 / 1024).toFixed(1)} MB` : "Up to 10 MB"}
            </Text>
            <Pressable
              onPress={source === "pdf" ? pickPdf : pickPhoto}
              disabled={isBusy}
              style={({ pressed }) => [styles.pickBtn, { borderColor: colors.primary, opacity: pressed ? 0.85 : isBusy ? 0.5 : 1 }]}
            >
              <Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>
                {picked ? "Choose a different file" : `Pick ${source === "pdf" ? "PDF" : "photo"}`}
              </Text>
            </Pressable>
          </View>
        ) : (
          <TextInput
            placeholder="Paste your menu here — name, price, and category on each line works best."
            placeholderTextColor={colors.mutedForeground}
            value={text}
            onChangeText={setText}
            editable={!isBusy}
            multiline
            style={[
              styles.textarea,
              { borderColor: colors.border, backgroundColor: colors.card, color: colors.foreground },
            ]}
          />
        )}

        {status !== "idle" && status !== "done" && status !== "error" ? (
          <View style={[styles.statusCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.statusText, { color: colors.foreground }]}>{statusLabel[status]}</Text>
          </View>
        ) : null}

        {detail && (status === "processing" || status === "saving" || status === "done") ? (() => {
          const withPhotos = detail.items.filter(i => !!(i.savedImageUrl || i.libraryImageUrl));
          if (withPhotos.length === 0) return null;
          return (
            <View style={{ gap: 6 }}>
              <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: "Inter_500Medium" }}>
                {withPhotos.length} of {detail.items.length} item{detail.items.length === 1 ? "" : "s"} matched a photo from the admin image library
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                {withPhotos.slice(0, 30).map(it => (
                  <Image
                    key={it.id}
                    source={{ uri: (it.savedImageUrl ?? it.libraryImageUrl) as string }}
                    style={{ width: 48, height: 48, borderRadius: 8, borderWidth: 1, borderColor: colors.border }}
                  />
                ))}
              </ScrollView>
            </View>
          );
        })() : null}

        {status === "done" ? (
          <View style={[styles.statusCard, { backgroundColor: "#dcfce7", borderColor: "#22c55e" }]}>
            <Ionicons name="checkmark-circle" size={22} color="#15803d" />
            <Text style={[styles.statusText, { color: "#14532d", flex: 1 }]}>{summary}</Text>
          </View>
        ) : null}

        {status === "error" && error ? (
          <View style={[styles.statusCard, { backgroundColor: "#fee2e2", borderColor: "#ef4444" }]}>
            <Ionicons name="alert-circle" size={22} color="#b91c1c" />
            <Text style={[styles.statusText, { color: "#7f1d1d", flex: 1 }]}>{error}</Text>
          </View>
        ) : null}

        {status === "done" ? (
          <View style={{ gap: 8 }}>
            <Pressable
              onPress={() => router.replace("/(owner)/menu" as never)}
              style={({ pressed }) => [styles.primaryBtn, { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 }]}
            >
              <Ionicons name="restaurant-outline" size={16} color="#fff" />
              <Text style={styles.primaryBtnText}>Open menu</Text>
            </Pressable>
            <Pressable
              onPress={reset}
              style={({ pressed }) => [styles.secondaryBtn, { borderColor: colors.border, opacity: pressed ? 0.85 : 1 }]}
            >
              <Text style={[styles.secondaryBtnText, { color: colors.foreground }]}>Import another</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            onPress={start}
            disabled={isBusy}
            style={({ pressed }) => [
              styles.primaryBtn,
              { backgroundColor: BRAND.ai, opacity: pressed || isBusy ? 0.7 : 1 },
            ]}
          >
            <Ionicons name="sparkles" size={16} color="#fff" />
            <Text style={styles.primaryBtnText}>{isBusy ? "Working…" : "Start import"}</Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  intro: { flexDirection: "row", gap: 10, alignItems: "flex-start", padding: 14, borderRadius: 12, borderWidth: 1 },
  introText: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", lineHeight: 18 },
  tabsRow: { flexDirection: "row", gap: 8 },
  tab: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5 },
  tabText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  dropCard: { alignItems: "center", padding: 24, borderRadius: 14, borderWidth: 1.5, borderStyle: "dashed", gap: 6 },
  dropTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginTop: 4 },
  dropSub: { fontSize: 12, fontFamily: "Inter_400Regular" },
  pickBtn: { marginTop: 8, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1.5 },
  textarea: { minHeight: 160, borderRadius: 12, borderWidth: 1, padding: 12, fontFamily: "Inter_400Regular", fontSize: 13, textAlignVertical: "top" },
  statusCard: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderRadius: 12, borderWidth: 1 },
  statusText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: 12 },
  primaryBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  secondaryBtn: { alignItems: "center", justifyContent: "center", paddingVertical: 12, borderRadius: 12, borderWidth: 1 },
  secondaryBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
