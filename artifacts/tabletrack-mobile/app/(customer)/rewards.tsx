import { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, ActivityIndicator } from "react-native";
import { useColors } from "@/hooks/useColors";

const apiBase = `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`;

interface Summary {
  config: { enabled: boolean; cashback: { enabled: boolean }; family: { enabled: boolean }; tiers: any[] };
  customer: { id: number; name: string; phone: string | null };
  points: { balance: number; lifetimeEarned: number };
  cashback: { balance: number } | null;
  tier: { current: { name: string; multiplier: number; perks?: string[] }; next: { name: string; threshold: number } | null; lifetimePoints: number };
  stampCards: { id: number; cardKey: string; current: number; required: number; completions: number }[];
  mysteryGrants: { id: number; status: string; rewardLabel: string | null }[];
  streak: { currentStreak: number; bestStreak: number } | null;
  referral: { code: string } | null;
  family: { group: any; members: any[] } | null;
  milestones: { milestoneKey: string; rewardType: string; rewardValue: any }[];
}

export default function RewardsScreen() {
  const colors = useColors();
  const [phone, setPhone] = useState("");
  const [restaurantId, setRestaurantId] = useState("1");
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function lookup() {
    setLoading(true); setErr(null); setData(null);
    try {
      const search = await fetch(`${apiBase}/restaurants/${restaurantId}/customers?search=${encodeURIComponent(phone)}`);
      const customers = (await search.json())?.data ?? [];
      const match = customers.find((c: any) => (c.phone || "").replace(/\D/g, "").endsWith(phone.replace(/\D/g, "")));
      if (!match) { setErr("No customer found with that phone."); return; }
      const sumRes = await fetch(`${apiBase}/restaurants/${restaurantId}/loyalty/summary/${match.id}`);
      if (!sumRes.ok) { setErr("Loyalty unavailable for this restaurant."); return; }
      setData(await sumRes.json());
    } catch (e: any) { setErr(e?.message || "Lookup failed"); }
    finally { setLoading(false); }
  }

  const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16, gap: 12 },
    title: { fontSize: 24, fontWeight: "700", color: colors.foreground, marginBottom: 6 },
    sub: { fontSize: 13, color: colors.mutedForeground, marginBottom: 12 },
    input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, color: colors.foreground, backgroundColor: colors.card },
    btn: { backgroundColor: colors.primary, padding: 12, borderRadius: 10, alignItems: "center" },
    btnText: { color: "#fff", fontWeight: "600" },
    card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 14, gap: 6 },
    cardLabel: { fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, color: colors.mutedForeground },
    cardValue: { fontSize: 22, fontWeight: "700", color: colors.foreground },
    row: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
    chip: { backgroundColor: colors.muted, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 99 },
    chipText: { fontSize: 12, color: colors.foreground },
    err: { color: "#dc2626", fontSize: 13 },
    sectionTitle: { fontSize: 14, fontWeight: "600", color: colors.foreground, marginTop: 8 },
  });

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>My Rewards</Text>
      <Text style={styles.sub}>Look up your loyalty balance, tier, and stamps using your registered phone number.</Text>

      <TextInput style={styles.input} placeholder="Restaurant ID" placeholderTextColor={colors.mutedForeground} keyboardType="number-pad" value={restaurantId} onChangeText={setRestaurantId} />
      <TextInput style={styles.input} placeholder="Phone number" placeholderTextColor={colors.mutedForeground} keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
      <TouchableOpacity style={styles.btn} onPress={lookup} disabled={!phone || loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Find my rewards</Text>}
      </TouchableOpacity>

      {err && <Text style={styles.err}>{err}</Text>}

      {data && (
        <View style={{ gap: 12, marginTop: 8 }}>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Hello</Text>
            <Text style={styles.cardValue}>{data.customer.name}</Text>
            {data.tier?.current && (
              <Text style={{ color: colors.primary, fontWeight: "600" }}>
                {data.tier.current.name} tier · {data.tier.current.multiplier}× points
              </Text>
            )}
            {data.tier?.next && (
              <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                {data.tier.next.threshold - data.tier.lifetimePoints} more points to {data.tier.next.name}
              </Text>
            )}
          </View>

          <View style={styles.row}>
            <View style={[styles.card, { flex: 1, minWidth: 140 }]}>
              <Text style={styles.cardLabel}>Points</Text>
              <Text style={styles.cardValue}>{data.points.balance.toLocaleString()}</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>{data.points.lifetimeEarned.toLocaleString()} lifetime</Text>
            </View>
            {data.cashback && (
              <View style={[styles.card, { flex: 1, minWidth: 140 }]}>
                <Text style={styles.cardLabel}>Cashback</Text>
                <Text style={styles.cardValue}>₹{Number(data.cashback.balance).toLocaleString()}</Text>
              </View>
            )}
          </View>

          {data.streak && (
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Visit streak</Text>
              <Text style={styles.cardValue}>{data.streak.currentStreak} 🔥</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>Personal best: {data.streak.bestStreak}</Text>
            </View>
          )}

          {data.stampCards.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Stamp cards</Text>
              {data.stampCards.map(s => (
                <View key={s.id} style={{ marginTop: 6 }}>
                  <Text style={{ color: colors.foreground, fontSize: 13 }}>{s.cardKey}: {s.current}/{s.required} stamps</Text>
                  <View style={{ height: 6, backgroundColor: colors.muted, borderRadius: 99, marginTop: 4, overflow: "hidden" }}>
                    <View style={{ height: 6, backgroundColor: colors.primary, width: `${Math.min(100, (s.current / Math.max(1, s.required)) * 100)}%` }} />
                  </View>
                  {s.completions > 0 && <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>{s.completions} completed</Text>}
                </View>
              ))}
            </View>
          )}

          {data.mysteryGrants.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Mystery rewards</Text>
              <View style={styles.row}>
                {data.mysteryGrants.map(m => (
                  <View key={m.id} style={styles.chip}>
                    <Text style={styles.chipText}>{m.status === "pending" ? "🎁 Tap to reveal" : m.rewardLabel || "Revealed"}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {data.referral?.code && (
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Refer a friend</Text>
              <Text style={[styles.cardValue, { fontFamily: "Menlo", fontSize: 18 }]}>{data.referral.code}</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>Share this code — your friend signs up, you both earn rewards.</Text>
            </View>
          )}

          {data.family?.members?.length ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Family ({data.family.members.length})</Text>
              {data.family.members.map((m: any, i: number) => (
                <Text key={i} style={{ color: colors.foreground, fontSize: 13 }}>• {m.customerName ?? `Member ${m.customerId}`}{m.role === "primary" ? " (head)" : ""}</Text>
              ))}
            </View>
          ) : null}

          {data.milestones.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Milestones reached</Text>
              {data.milestones.map((m, i) => (
                <Text key={i} style={{ color: colors.foreground, fontSize: 13 }}>🏆 {m.milestoneKey} → {m.rewardType} {String(m.rewardValue)}</Text>
              ))}
            </View>
          )}
        </View>
      )}
    </ScrollView>
  );
}
