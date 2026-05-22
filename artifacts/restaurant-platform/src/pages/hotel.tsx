import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Layout as AppLayout } from "@/components/layout/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/PhoneInput";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  useRestaurantInfo, useToggleHotelMode,
  useHotelGuests, useCreateHotelGuest,
  useHotelStays, useHotelStay, useCreateHotelStay,
  useHotelPackages, useCreateHotelPackage,
  useAddFolioLine, useCloseFolio,
  usePostMinibar, useMinibarPostings,
  useHousekeepingRequests, useCreateHousekeepingRequest,
  useBanquetEvents, useCreateBanquetEvent, useCloseBanquetEvent,
} from "@/lib/hooks";

function inr(v: string | number): string {
  return `₹${Number(v).toFixed(2)}`;
}

function HotelDisabled({ onEnable }: { onEnable: () => void }) {
  return (
    <Card>
      <CardHeader><CardTitle>Hotel Restaurant Mode</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Enable hotel mode to allow room-number ordering, package auto-comp, mini-bar postings,
          banquet event tabs, housekeeping food requests, and consolidated check-out folios for
          this outlet. Stand-alone restaurants are unaffected.
        </p>
        <Button onClick={onEnable} data-testid="button-enable-hotel-mode">Enable Hotel Mode</Button>
      </CardContent>
    </Card>
  );
}

function GuestsTab() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", email: "", isVip: false, allergies: "", preferences: "", notes: "" });
  const { data: guests = [] } = useHotelGuests(q);
  const create = useCreateHotelGuest();
  const { toast } = useToast();
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Guest Profiles</CardTitle>
        <div className="flex gap-2">
          <Input placeholder="Search name/phone/email" value={q} onChange={(e) => setQ(e.target.value)} className="w-64" data-testid="input-guest-search" />
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button data-testid="button-add-guest">+ Guest</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>New Guest Profile</DialogTitle></DialogHeader>
              <div className="grid gap-3">
                <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-guest-name" /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Phone</Label><PhoneInput value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} /></div>
                  <div><Label>Email</Label><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="input-guest-email" /></div>
                </div>
                <div><Label>Allergies</Label><Input value={form.allergies} onChange={(e) => setForm({ ...form, allergies: e.target.value })} /></div>
                <div><Label>Preferences</Label><Input value={form.preferences} onChange={(e) => setForm({ ...form, preferences: e.target.value })} /></div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.isVip} onChange={(e) => setForm({ ...form, isVip: e.target.checked })} />
                  VIP guest
                </label>
              </div>
              <DialogFooter>
                <Button onClick={() => {
                  if (!form.name) return;
                  create.mutate(form, {
                    onSuccess: () => { toast({ title: "Guest added" }); setOpen(false); setForm({ name: "", phone: "", email: "", isVip: false, allergies: "", preferences: "", notes: "" }); },
                    onError: (e) => toast({ title: "Failed", description: (e as Error).message, variant: "destructive" }),
                  });
                }} data-testid="button-save-guest">Save</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Phone</TableHead><TableHead>Email</TableHead><TableHead>Tags</TableHead></TableRow></TableHeader>
          <TableBody>
            {guests.map((g) => (
              <TableRow key={g.id} data-testid={`row-guest-${g.id}`}>
                <TableCell>{g.name}</TableCell>
                <TableCell>{g.phone ?? "—"}</TableCell>
                <TableCell>{g.email ?? "—"}</TableCell>
                <TableCell>{g.isVip && <Badge>VIP</Badge>}</TableCell>
              </TableRow>
            ))}
            {guests.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-8">No guests yet</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function StayDetail({ stayId, onClose }: { stayId: number; onClose: () => void }) {
  const { data: detail } = useHotelStay(stayId);
  const addLine = useAddFolioLine();
  const close = useCloseFolio();
  const minibar = usePostMinibar();
  const { toast } = useToast();
  const [adj, setAdj] = useState({ kind: "discount", description: "", amount: "" });
  const [splits, setSplits] = useState<Array<{ method: string; amount: string }>>([{ method: "cash", amount: "" }]);
  const [mb, setMb] = useState({ itemName: "", quantity: "1", unitPrice: "" });

  if (!detail) return <div className="p-4 text-sm">Loading…</div>;
  const balance = Number(detail.folio?.balance ?? 0);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Room {detail.roomNumber} — {detail.guest?.name}</h3>
          <p className="text-sm text-muted-foreground">Folio #{detail.folio?.id} · Status {detail.folio?.status}</p>
        </div>
        <Button variant="outline" onClick={onClose}>Back</Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card><CardHeader><CardTitle className="text-sm">Charges</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{inr(detail.folio?.totalCharges ?? 0)}</CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm">Payments</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{inr(detail.folio?.totalPayments ?? 0)}</CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm">Balance Due</CardTitle></CardHeader><CardContent className="text-2xl font-semibold" data-testid="text-folio-balance">{inr(balance)}</CardContent></Card>
      </div>

      {detail.package && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Package: {detail.package.name}</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Daily entitlement: {detail.package.dailyEntitlement} · Used today: {detail.packageUsedToday}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Folio Lines</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Source</TableHead><TableHead>Description</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
            <TableBody>
              {detail.lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>{new Date(l.createdAt).toLocaleString()}</TableCell>
                  <TableCell><Badge variant="outline">{l.source}</Badge></TableCell>
                  <TableCell>{l.description}</TableCell>
                  <TableCell className="text-right">
                    {l.kind === "payment" || l.kind === "discount" || l.kind === "comp" ? "−" : ""}{inr(l.amount)}
                  </TableCell>
                </TableRow>
              ))}
              {detail.lines.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-sm py-6 text-muted-foreground">No lines yet</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-sm">Adjustment / Manual Charge</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <Select value={adj.kind} onValueChange={(v) => setAdj({ ...adj, kind: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="charge">Charge</SelectItem>
                <SelectItem value="discount">Discount</SelectItem>
                <SelectItem value="comp">Comp</SelectItem>
              </SelectContent>
            </Select>
            <Input placeholder="Description" value={adj.description} onChange={(e) => setAdj({ ...adj, description: e.target.value })} />
            <Input placeholder="Amount" type="number" value={adj.amount} onChange={(e) => setAdj({ ...adj, amount: e.target.value })} />
            <Button className="w-full" onClick={() => {
              const n = Number(adj.amount);
              if (!n || !adj.description) return;
              addLine.mutate({ folioId: detail.folio!.id, kind: adj.kind, description: adj.description, amount: n, source: "adjustment" }, {
                onSuccess: () => { toast({ title: "Line added" }); setAdj({ kind: adj.kind, description: "", amount: "" }); },
              });
            }} data-testid="button-add-folio-line">Add</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Mini-Bar Posting</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <Input placeholder="Item name" value={mb.itemName} onChange={(e) => setMb({ ...mb, itemName: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="Qty" type="number" value={mb.quantity} onChange={(e) => setMb({ ...mb, quantity: e.target.value })} />
              <Input placeholder="Unit price" type="number" value={mb.unitPrice} onChange={(e) => setMb({ ...mb, unitPrice: e.target.value })} />
            </div>
            <Button className="w-full" onClick={() => {
              const qty = Number(mb.quantity), price = Number(mb.unitPrice);
              if (!mb.itemName || !qty || !price) return;
              minibar.mutate({ stayId: detail.id, itemName: mb.itemName, quantity: qty, unitPrice: price }, {
                onSuccess: () => { toast({ title: "Mini-bar posted" }); setMb({ itemName: "", quantity: "1", unitPrice: "" }); },
              });
            }} data-testid="button-post-minibar">Post Mini-Bar</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Check-Out Settlement</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-muted-foreground">Outstanding: {inr(balance)}</p>
            {splits.map((s, i) => (
              <div key={i} className="grid grid-cols-2 gap-2">
                <Select value={s.method} onValueChange={(v) => { const ns = [...splits]; ns[i] = { ...ns[i], method: v }; setSplits(ns); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="card">Card</SelectItem>
                    <SelectItem value="upi">UPI</SelectItem>
                    <SelectItem value="bank">Bank</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
                <Input placeholder="Amount" type="number" value={s.amount} onChange={(e) => { const ns = [...splits]; ns[i] = { ...ns[i], amount: e.target.value }; setSplits(ns); }} />
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setSplits([...splits, { method: "card", amount: "" }])}>+ Split Tender</Button>
            <Button className="w-full" disabled={balance <= 0} onClick={() => {
              const payload = splits.map(s => ({ method: s.method, amount: Number(s.amount) })).filter(x => x.amount > 0);
              const total = payload.reduce((a, b) => a + b.amount, 0);
              if (Math.abs(total - balance) > 0.01) {
                toast({ title: "Splits must equal balance", description: `${total.toFixed(2)} vs ${balance.toFixed(2)}`, variant: "destructive" });
                return;
              }
              close.mutate({ folioId: detail.folio!.id, splits: payload }, {
                onSuccess: (r) => { toast({ title: "Folio closed", description: `Invoice ${r.invoiceNumber}` }); onClose(); },
                onError: (e) => toast({ title: "Failed", description: (e as Error).message, variant: "destructive" }),
              });
            }} data-testid="button-close-folio">Close Folio & Check Out</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StaysTab() {
  const [openStay, setOpenStay] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const { data: stays = [] } = useHotelStays("in_house");
  const { data: guests = [] } = useHotelGuests();
  const { data: packages = [] } = useHotelPackages();
  const create = useCreateHotelStay();
  const { toast } = useToast();
  const [form, setForm] = useState({ guestId: "", roomNumber: "", partySize: "1", packageId: "" });

  if (openStay) return <StayDetail stayId={openStay} onClose={() => setOpenStay(null)} />;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>In-House Stays</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button data-testid="button-add-stay">+ Check In</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New Stay (Check In)</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Guest</Label>
                <Select value={form.guestId} onValueChange={(v) => setForm({ ...form, guestId: v })}>
                  <SelectTrigger data-testid="select-stay-guest"><SelectValue placeholder="Select guest" /></SelectTrigger>
                  <SelectContent>
                    {guests.map(g => <SelectItem key={g.id} value={String(g.id)}>{g.name}{g.phone ? ` · ${g.phone}` : ""}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Room #</Label><Input value={form.roomNumber} onChange={(e) => setForm({ ...form, roomNumber: e.target.value })} data-testid="input-room-number" /></div>
                <div><Label>Party size</Label><Input type="number" value={form.partySize} onChange={(e) => setForm({ ...form, partySize: e.target.value })} /></div>
              </div>
              <div>
                <Label>Package (optional)</Label>
                <Select value={form.packageId} onValueChange={(v) => setForm({ ...form, packageId: v })}>
                  <SelectTrigger><SelectValue placeholder="No package" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">None</SelectItem>
                    {packages.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => {
                if (!form.guestId || !form.roomNumber) return;
                create.mutate({
                  guestId: Number(form.guestId), roomNumber: form.roomNumber,
                  partySize: Number(form.partySize) || 1,
                  packageId: form.packageId ? Number(form.packageId) : undefined,
                }, {
                  onSuccess: () => { toast({ title: "Checked in" }); setOpen(false); setForm({ guestId: "", roomNumber: "", partySize: "1", packageId: "" }); },
                  onError: (e) => toast({ title: "Failed", description: (e as Error).message, variant: "destructive" }),
                });
              }} data-testid="button-save-stay">Check In</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow><TableHead>Room</TableHead><TableHead>Guest</TableHead><TableHead>Check In</TableHead><TableHead className="text-right">Folio Balance</TableHead><TableHead></TableHead></TableRow></TableHeader>
          <TableBody>
            {stays.map(s => (
              <TableRow key={s.id} data-testid={`row-stay-${s.id}`}>
                <TableCell className="font-medium">{s.roomNumber}</TableCell>
                <TableCell>{s.guest?.name}{s.guest?.isVip && <Badge className="ml-2">VIP</Badge>}</TableCell>
                <TableCell>{new Date(s.checkInAt).toLocaleString()}</TableCell>
                <TableCell className="text-right">{s.folio ? inr(s.folio.balance) : "—"}</TableCell>
                <TableCell><Button size="sm" variant="outline" onClick={() => setOpenStay(s.id)} data-testid={`button-open-stay-${s.id}`}>Open</Button></TableCell>
              </TableRow>
            ))}
            {stays.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-sm py-8 text-muted-foreground">No in-house stays</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function PackagesTab() {
  const { data: pkgs = [] } = useHotelPackages();
  const create = useCreateHotelPackage();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", mealType: "breakfast", dailyEntitlement: "2", windowStart: "06:30", windowEnd: "10:30" });
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Meal Packages (Auto-Comp)</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button data-testid="button-add-package">+ Package</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New Package</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div><Label>Description</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Meal type</Label>
                  <Select value={form.mealType} onValueChange={(v) => setForm({ ...form, mealType: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="breakfast">Breakfast</SelectItem>
                      <SelectItem value="lunch">Lunch</SelectItem>
                      <SelectItem value="dinner">Dinner</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Daily entitlement (items)</Label><Input type="number" value={form.dailyEntitlement} onChange={(e) => setForm({ ...form, dailyEntitlement: e.target.value })} /></div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Window start</Label><Input type="time" value={form.windowStart} onChange={(e) => setForm({ ...form, windowStart: e.target.value })} /></div>
                <div><Label>Window end</Label><Input type="time" value={form.windowEnd} onChange={(e) => setForm({ ...form, windowEnd: e.target.value })} /></div>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => {
                if (!form.name) return;
                create.mutate({
                  name: form.name, description: form.description, mealType: form.mealType,
                  dailyEntitlement: Number(form.dailyEntitlement) || 2,
                  windowStart: form.windowStart, windowEnd: form.windowEnd,
                } as Record<string, unknown> as Parameters<typeof create.mutate>[0], {
                  onSuccess: () => { toast({ title: "Package created" }); setOpen(false); },
                  onError: (e) => toast({ title: "Failed", description: (e as Error).message, variant: "destructive" }),
                });
              }} data-testid="button-save-package">Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Meal</TableHead><TableHead>Entitlement</TableHead><TableHead>Window</TableHead></TableRow></TableHeader>
          <TableBody>
            {pkgs.map(p => (
              <TableRow key={p.id}>
                <TableCell>{p.name}</TableCell>
                <TableCell><Badge variant="outline">{p.mealType}</Badge></TableCell>
                <TableCell>{p.dailyEntitlement} / day</TableCell>
                <TableCell>{p.windowStart ?? "—"} – {p.windowEnd ?? "—"}</TableCell>
              </TableRow>
            ))}
            {pkgs.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-sm py-6 text-muted-foreground">No packages</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function MinibarTab() {
  const { data: rows = [] } = useMinibarPostings();
  return (
    <Card>
      <CardHeader><CardTitle>Recent Mini-Bar Postings</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Item</TableHead><TableHead>Qty</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map(r => (
              <TableRow key={r.id}>
                <TableCell>{new Date(r.createdAt).toLocaleString()}</TableCell>
                <TableCell>{r.itemName}</TableCell>
                <TableCell>{r.quantity}</TableCell>
                <TableCell className="text-right">{inr(r.totalAmount)}</TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-sm py-6 text-muted-foreground">No postings</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function HousekeepingTab() {
  const { data: stays = [] } = useHotelStays("in_house");
  const { data: rows = [] } = useHousekeepingRequests();
  const create = useCreateHousekeepingRequest();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ stayId: "", description: "" });
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Housekeeping Food Requests</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button data-testid="button-add-housekeeping">+ Request</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New Housekeeping Request</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Stay</Label>
                <Select value={form.stayId} onValueChange={(v) => setForm({ ...form, stayId: v })}>
                  <SelectTrigger><SelectValue placeholder="Select room" /></SelectTrigger>
                  <SelectContent>
                    {stays.map(s => <SelectItem key={s.id} value={String(s.id)}>Room {s.roomNumber} — {s.guest?.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Description</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="e.g. Extra towels + 2 bottles of water" /></div>
            </div>
            <DialogFooter>
              <Button onClick={() => {
                if (!form.stayId || !form.description) return;
                create.mutate({ stayId: Number(form.stayId), description: form.description }, {
                  onSuccess: () => { toast({ title: "Request logged" }); setOpen(false); setForm({ stayId: "", description: "" }); },
                });
              }} data-testid="button-save-housekeeping">Submit</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Stay</TableHead><TableHead>Request</TableHead><TableHead>Order</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map(r => (
              <TableRow key={r.id}>
                <TableCell>{new Date(r.createdAt).toLocaleString()}</TableCell>
                <TableCell>#{r.stayId}</TableCell>
                <TableCell>{r.description}</TableCell>
                <TableCell>{r.orderId ? `Order #${r.orderId}` : "—"}</TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-sm py-6 text-muted-foreground">No requests</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function BanquetTab() {
  const { data: events = [] } = useBanquetEvents();
  const { data: stays = [] } = useHotelStays("in_house");
  const create = useCreateBanquetEvent();
  const close = useCloseBanquetEvent();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", hostStayId: "", hostName: "", partySize: "10", scheduledAt: "" });
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Banquet Events</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button data-testid="button-add-banquet">+ Event</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New Banquet Event</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Event name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div>
                <Label>Host (in-house guest, optional)</Label>
                <Select value={form.hostStayId} onValueChange={(v) => setForm({ ...form, hostStayId: v })}>
                  <SelectTrigger><SelectValue placeholder="External host" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">External host</SelectItem>
                    {stays.map(s => <SelectItem key={s.id} value={String(s.id)}>Room {s.roomNumber} — {s.guest?.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {!form.hostStayId && <div><Label>Host name</Label><Input value={form.hostName} onChange={(e) => setForm({ ...form, hostName: e.target.value })} /></div>}
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Party size</Label><Input type="number" value={form.partySize} onChange={(e) => setForm({ ...form, partySize: e.target.value })} /></div>
                <div><Label>Scheduled at</Label><Input type="datetime-local" value={form.scheduledAt} onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })} /></div>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => {
                if (!form.name) return;
                create.mutate({
                  name: form.name,
                  hostStayId: form.hostStayId ? Number(form.hostStayId) : null,
                  hostName: form.hostName || null,
                  partySize: Number(form.partySize) || 1,
                  scheduledAt: form.scheduledAt || null,
                } as Record<string, unknown> as Parameters<typeof create.mutate>[0], {
                  onSuccess: () => { toast({ title: "Event created" }); setOpen(false); },
                });
              }} data-testid="button-save-banquet">Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow><TableHead>Event</TableHead><TableHead>Host</TableHead><TableHead>Party</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
          <TableBody>
            {events.map(e => (
              <TableRow key={e.id}>
                <TableCell>{e.name}</TableCell>
                <TableCell>{e.hostStayId ? `Room (stay #${e.hostStayId})` : (e.hostName ?? "—")}</TableCell>
                <TableCell>{e.partySize}</TableCell>
                <TableCell><Badge variant={e.status === "open" ? "default" : "outline"}>{e.status}</Badge></TableCell>
                <TableCell>
                  {e.status === "open" && (
                    <div className="flex gap-2">
                      {e.hostStayId && (
                        <Button size="sm" variant="outline" onClick={() => close.mutate({ eventId: e.id, rollToHostFolio: true }, {
                          onSuccess: () => toast({ title: "Rolled to host folio" }),
                        })}>Roll to room</Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => close.mutate({ eventId: e.id }, {
                        onSuccess: () => toast({ title: "Use folios to settle independently" }),
                      })}>Close</Button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {events.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-sm py-6 text-muted-foreground">No events</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export default function HotelPage() {
  const { data: info } = useRestaurantInfo();
  const toggle = useToggleHotelMode();
  const qc = useQueryClient();
  const { toast } = useToast();

  const enabled = !!info?.isHotelMode;

  return (
    <AppLayout>
      <div className="container mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Hotel Mode</h1>
            <p className="text-sm text-muted-foreground">Room charge, packages, mini-bar, banquet, housekeeping &amp; consolidated check-out.</p>
          </div>
          {enabled && (
            <Button variant="outline" disabled={toggle.isPending} onClick={() => {
              toggle.mutate(false, {
                onSuccess: () => { toast({ title: "Hotel mode disabled" }); qc.invalidateQueries(); },
                onError: (e) => toast({
                  title: "Couldn't disable Hotel Mode",
                  description: (e as Error).message || "Only the restaurant owner or manager can change this. If you're using super-admin 'View as', switch back to your own login.",
                  variant: "destructive",
                }),
              });
            }} data-testid="button-disable-hotel-mode">Disable Hotel Mode</Button>
          )}
        </div>

        {!enabled && (
          <HotelDisabled onEnable={() => toggle.mutate(true, {
            onSuccess: () => { toast({ title: "Hotel mode enabled" }); qc.invalidateQueries(); },
            onError: (e) => toast({
              title: "Couldn't enable Hotel Mode",
              description: (e as Error).message || "Only the restaurant owner or manager can change this. If you're using super-admin 'View as', switch back to your own login.",
              variant: "destructive",
            }),
          })} />
        )}

        {enabled && (
          <Tabs defaultValue="stays">
            <TabsList>
              <TabsTrigger value="stays" data-testid="tab-stays">Stays &amp; Folios</TabsTrigger>
              <TabsTrigger value="guests" data-testid="tab-guests">Guests</TabsTrigger>
              <TabsTrigger value="packages" data-testid="tab-packages">Packages</TabsTrigger>
              <TabsTrigger value="minibar" data-testid="tab-minibar">Mini-Bar</TabsTrigger>
              <TabsTrigger value="housekeeping" data-testid="tab-housekeeping">Housekeeping</TabsTrigger>
              <TabsTrigger value="banquet" data-testid="tab-banquet">Banquet</TabsTrigger>
            </TabsList>
            <TabsContent value="stays"><StaysTab /></TabsContent>
            <TabsContent value="guests"><GuestsTab /></TabsContent>
            <TabsContent value="packages"><PackagesTab /></TabsContent>
            <TabsContent value="minibar"><MinibarTab /></TabsContent>
            <TabsContent value="housekeeping"><HousekeepingTab /></TabsContent>
            <TabsContent value="banquet"><BanquetTab /></TabsContent>
          </Tabs>
        )}
      </div>
    </AppLayout>
  );
}
