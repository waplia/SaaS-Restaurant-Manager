import React, { useState, useRef } from "react";
import { View, StyleSheet, Pressable, Platform, ScrollView, TextInput } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { RoleShellHeader } from "@/components/RoleShellHeader";
import { Alert } from "@/components/ui/AppAlert";
import {
  AppText, AppButton, AppCard, AppIcon, AppEmptyState,
} from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { QuickActionSheet, type QuickActionKind } from "@/components/inventory/QuickActionSheet";
import type { InventoryItem } from "@/components/inventory/types";

/**
 * Scan tab. Two flows:
 *  1. Barcode scan -> look up the inventory item by sku/barcode/name and
 *     open a Stock In quick-action sheet pre-filled with that item.
 *  2. Invoice photo upload -> presigned PUT to object storage, then call
 *     the vendor-invoice OCR endpoint (no-ops gracefully if not enabled).
 */
export default function ScanScreen() {
  const colors = useColors();
  const { restaurantId, outletScopeId } = useAuth();
  const scopedId = outletScopeId ?? restaurantId;
  const qc = useQueryClient();

  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [lastUpload, setLastUpload] = useState<{ path: string; ocrStatus: string } | null>(null);
  const [manualCode, setManualCode] = useState("");
  const [actionKind, setActionKind] = useState<QuickActionKind | null>(null);
  const [actionItem, setActionItem] = useState<InventoryItem | null>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const isWeb = Platform.OS === "web";

  async function lookupAndOpen(code: string) {
    if (!code.trim()) return;
    setLookingUp(true);
    try {
      const all = await customFetch<InventoryItem[]>(`/api/restaurants/${scopedId}/inventory`);
      const c = code.trim().toLowerCase();
      const match = all.find(it => {
        const sku = (it as InventoryItem & { sku?: string; barcode?: string }).sku?.toLowerCase();
        const barcode = (it as InventoryItem & { sku?: string; barcode?: string }).barcode?.toLowerCase();
        return sku === c || barcode === c || it.name.toLowerCase() === c || it.name.toLowerCase().includes(c);
      });
      if (!match) {
        Alert.alert("Item not found", `No stock item matches "${code}". Add it from the web app first.`);
        setScanned(false);
        return;
      }
      setActionItem(match);
      setActionKind("in");
    } catch (e) {
      Alert.alert("Lookup failed", e instanceof Error ? e.message : "Try again.");
      setScanned(false);
    } finally {
      setLookingUp(false);
    }
  }

  const onBarcodeScanned = ({ data }: { data: string }) => {
    if (scanned || lookingUp) return;
    setScanned(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    void lookupAndOpen(data);
  };

  async function pickAndUploadInvoice() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission needed", "Allow photo access to upload an invoice.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
    });
    if (result.canceled || !result.assets?.[0]) return;
    await uploadAsset(result.assets[0]);
  }

  async function takeAndUploadInvoice() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission needed", "Allow camera access to capture an invoice.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
    });
    if (result.canceled || !result.assets?.[0]) return;
    await uploadAsset(result.assets[0]);
  }

  async function uploadAsset(asset: ImagePicker.ImagePickerAsset) {
    setUploading(true);
    setLastUpload(null);
    try {
      const fileName = asset.fileName ?? `invoice-${Date.now()}.jpg`;
      const contentType = asset.mimeType ?? "image/jpeg";
      const blob = await (await fetch(asset.uri)).blob();
      const presign = await customFetch<{ uploadURL: string; objectPath: string }>(
        `/api/restaurants/${scopedId}/storage/uploads/request-url`,
        { method: "POST", body: JSON.stringify({ name: fileName, size: blob.size, contentType }) },
      );
      const put = await fetch(presign.uploadURL, {
        method: "PUT", headers: { "Content-Type": contentType }, body: blob,
      });
      if (!put.ok) throw new Error(`Upload failed (${put.status})`);
      await customFetch(`/api/restaurants/${scopedId}/storage/uploads/finalize`, {
        method: "POST", body: JSON.stringify({ objectPath: presign.objectPath }),
      });

      // Try OCR pipeline. If it isn't enabled on this plan, fall back to a
      // silent "uploaded only" message — the file is still saved and visible
      // in the web app's vendor-bills section.
      let ocrStatus = "uploaded";
      try {
        await customFetch(`/api/restaurants/${scopedId}/vendor-invoices/upload`, {
          method: "POST",
          body: JSON.stringify({ objectPath: presign.objectPath, pageCountHint: 1 }),
        });
        ocrStatus = "ocr_started";
        qc.invalidateQueries({ queryKey: ["vendor-invoices", scopedId] });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        if (/not.*enabled|plan|feature|403|404/i.test(msg)) {
          ocrStatus = "uploaded_no_ocr";
        } else {
          ocrStatus = "ocr_failed";
        }
      }
      setLastUpload({ path: presign.objectPath, ocrStatus });
    } catch (e) {
      Alert.alert("Upload failed", e instanceof Error ? e.message : "Try again.");
    } finally {
      setUploading(false);
    }
  }

  const cameraReady = !isWeb && permission?.granted;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <RoleShellHeader title="Scan" subtitle="Barcode or invoice" />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 140, gap: 16 }}>
        <AppCard padding={0} style={{ overflow: "hidden" }}>
          <View style={[styles.cameraBox, { backgroundColor: "#000" }]}>
            {cameraReady ? (
              <>
                <CameraView
                  style={StyleSheet.absoluteFill}
                  facing="back"
                  barcodeScannerSettings={{ barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e", "code128", "code39", "qr", "itf14", "pdf417"] }}
                  onBarcodeScanned={scanned ? undefined : onBarcodeScanned}
                />
                <View style={styles.scanFrame} pointerEvents="none">
                  <View style={[styles.corner, styles.tl]} />
                  <View style={[styles.corner, styles.tr]} />
                  <View style={[styles.corner, styles.bl]} />
                  <View style={[styles.corner, styles.br]} />
                </View>
                {scanned ? (
                  <Pressable onPress={() => setScanned(false)} style={[styles.rescan, { backgroundColor: colors.primary }]}>
                    <AppText variant="bodyMd" color="#fff" weight="semibold">Tap to scan again</AppText>
                  </Pressable>
                ) : null}
              </>
            ) : (
              <View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center", padding: 24, gap: 12 }]}>
                <AppIcon name="scan-outline" size={48} color="#fff" />
                <AppText variant="bodyMd" color="#fff" align="center">
                  {isWeb ? "Barcode scanning isn't available in the web preview." : "Camera permission needed to scan barcodes."}
                </AppText>
                {!isWeb ? (
                  <AppButton label="Allow camera" onPress={requestPermission} variant="secondary" />
                ) : null}
              </View>
            )}
          </View>
          <View style={{ padding: 12, gap: 8 }}>
            <AppText variant="small" color="mutedForeground">Or look up by SKU / barcode / name</AppText>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TextInput
                value={manualCode}
                onChangeText={setManualCode}
                placeholder="e.g. 8901234567890 or Tomato"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="none"
                style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, color: colors.foreground, fontFamily: "Inter_400Regular", fontSize: 14 }}
              />
              <AppButton
                label={lookingUp ? "…" : "Find"}
                onPress={() => lookupAndOpen(manualCode)}
                disabled={!manualCode.trim() || lookingUp}
                loading={lookingUp}
              />
            </View>
          </View>
        </AppCard>

        <AppCard>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <View style={{ width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "#0ea5e91A" }}>
              <AppIcon name="document-attach-outline" size={20} color="#0ea5e9" />
            </View>
            <View style={{ flex: 1 }}>
              <AppText variant="bodyMd" weight="semibold">Vendor invoice</AppText>
              <AppText variant="small" color="mutedForeground">Photo a paper bill and we'll save it. OCR runs automatically when enabled.</AppText>
            </View>
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <AppButton label="Take photo" leftIcon="camera-outline" onPress={takeAndUploadInvoice} loading={uploading} disabled={uploading} fullWidth />
            <AppButton label="From library" variant="secondary" leftIcon="image-outline" onPress={pickAndUploadInvoice} loading={uploading} disabled={uploading} fullWidth />
          </View>
          {lastUpload ? (
            <View style={{ marginTop: 12, padding: 10, borderRadius: 10, backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <AppIcon name="checkmark-circle-outline" size={18} color="#16a34a" />
                <AppText variant="small" weight="semibold">
                  {lastUpload.ocrStatus === "ocr_started" ? "Uploaded — OCR in progress" :
                   lastUpload.ocrStatus === "uploaded_no_ocr" ? "Uploaded — review on web (OCR not enabled)" :
                   lastUpload.ocrStatus === "ocr_failed" ? "Uploaded — OCR couldn't start" :
                   "Uploaded"}
                </AppText>
              </View>
              <AppText variant="micro" color="mutedForeground" numberOfLines={1}>{lastUpload.path}</AppText>
            </View>
          ) : null}
        </AppCard>

        {(isWeb || !cameraReady) && !permission?.granted ? (
          <AppEmptyState
            icon="information-circle-outline"
            title="Tip"
            description="On a real device, point the camera at a barcode and it'll auto-detect. Use the manual search if scanning isn't available."
          />
        ) : null}
      </ScrollView>

      <QuickActionSheet
        kind={actionKind}
        preselect={actionItem}
        onClose={() => { setActionKind(null); setActionItem(null); setScanned(false); }}
        onDone={() => { setScanned(false); }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  cameraBox: { aspectRatio: 1, position: "relative" },
  scanFrame: { position: "absolute", top: "20%", left: "15%", right: "15%", bottom: "20%" },
  corner: { position: "absolute", width: 26, height: 26, borderColor: "#fff" },
  tl: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3 },
  tr: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3 },
  br: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3 },
  rescan: { position: "absolute", bottom: 16, alignSelf: "center", paddingHorizontal: 18, paddingVertical: 10, borderRadius: 22 },
});
