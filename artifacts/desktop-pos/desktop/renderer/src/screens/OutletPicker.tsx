import { useEffect, useState } from "react";
import type { Branch, Restaurant, SelectionState } from "../../../shared/ipc-contract";
import { Button, Card, Banner, BrandHeader, FullscreenCenter, Spinner, colors } from "../ui/components";

interface Props {
  selection: SelectionState;
  onPicked: (selection: SelectionState) => void;
  onSignOut: () => void;
}

export function OutletPickerScreen({ selection, onPicked, onSignOut }: Props) {
  const [restaurants, setRestaurants] = useState<Restaurant[] | null>(null);
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [restaurantId, setRestaurantId] = useState<number | null>(selection.restaurantId);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    window.khanalagao.restaurants.list()
      .then(setRestaurants)
      .catch((err) => setError((err as Error).message));
  }, []);

  // Auto-pick when only one restaurant exists.
  useEffect(() => {
    if (restaurants && restaurants.length === 1 && !restaurantId) {
      setRestaurantId(restaurants[0].id);
    }
  }, [restaurants, restaurantId]);

  useEffect(() => {
    if (!restaurantId) { setBranches(null); return; }
    setBranches(null); setError(null);
    window.khanalagao.branches.list({ restaurantId })
      .then(setBranches)
      .catch((err) => setError((err as Error).message));
  }, [restaurantId]);

  const pickRestaurant = async (r: Restaurant) => {
    setBusy(true); setError(null);
    try {
      await window.khanalagao.selection.setRestaurant({ restaurantId: r.id });
      setRestaurantId(r.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const pickBranch = async (b: Branch) => {
    setBusy(true); setError(null);
    try {
      const next = await window.khanalagao.selection.setBranch({ branchId: b.id, branchName: b.name });
      onPicked(next);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <FullscreenCenter>
      <div style={{ width: "min(960px, 95vw)" }}>
        <BrandHeader subtitle={restaurantId ? "Pick your branch" : "Pick a restaurant"} />
        {error && <div style={{ marginBottom: 16 }}><Banner kind="error">{error}</Banner></div>}

        {!restaurants && <Center><Spinner /></Center>}

        {restaurants && !restaurantId && (
          <Grid>
            {restaurants.length === 0 && <Empty msg="You don't have access to any restaurants yet." />}
            {restaurants.map((r) => (
              <Card key={r.id} onClick={() => pickRestaurant(r)}>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{r.name}</div>
                {r.city && <div style={{ color: colors.textDim, fontSize: 13, marginTop: 4 }}>{r.city}</div>}
              </Card>
            ))}
          </Grid>
        )}

        {restaurantId && (
          <>
            {!branches && <Center><Spinner /></Center>}
            {branches && (
              <Grid>
                {branches.length === 0 && <Empty msg="No branches found for this restaurant." />}
                {branches.map((b) => (
                  <Card key={b.id} onClick={() => pickBranch(b)} selected={selection.branchId === b.id}>
                    <div style={{ fontSize: 18, fontWeight: 700 }}>{b.name}</div>
                    {b.address && <div style={{ color: colors.textDim, fontSize: 13, marginTop: 4 }}>{b.address}</div>}
                  </Card>
                ))}
              </Grid>
            )}
            <div style={{ marginTop: 20, textAlign: "center" }}>
              <Button variant="ghost" onClick={() => setRestaurantId(null)} disabled={busy}>
                ← Choose a different restaurant
              </Button>
            </div>
          </>
        )}

        <div style={{ marginTop: 24, textAlign: "center" }}>
          <button
            type="button"
            onClick={onSignOut}
            style={{ background: "none", border: 0, color: colors.textMuted, cursor: "pointer", fontSize: 12 }}
          >Sign out</button>
        </div>
      </div>
    </FullscreenCenter>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div style={{
    display: "grid", gap: 16,
    gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
  }}>{children}</div>;
}
function Center({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "grid", placeItems: "center", padding: 40 }}>{children}</div>;
}
function Empty({ msg }: { msg: string }) {
  return <div style={{ color: colors.textDim, gridColumn: "1 / -1", textAlign: "center", padding: 40 }}>{msg}</div>;
}
