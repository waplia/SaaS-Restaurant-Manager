import { useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  useCustomers, useCreateCustomer, useUpdateCustomer,
  useCustomerLoyalty, useAddLoyaltyPoints,
  useCoupons, useCreateCoupon, useUpdateCoupon, useDeleteCoupon,
  useCustomerOrders,
} from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Plus, Search, Mail, Phone, Star, ShoppingBag, X, Pencil,
  Gift, Trash2, Tag, Users, ChevronRight, ArrowUpCircle, ArrowDownCircle, Clock,
  Receipt, MapPin,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import type { Customer, LoyaltyTransaction, Coupon, Order } from "@/lib/types";

const TABS = ["Customers", "Coupons"] as const;
type Tab = typeof TABS[number];

function formatDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function formatDateTime(d: string) {
  return new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function CustomerDetailPanel({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const { data: loyalty } = useCustomerLoyalty(customer.id);
  const { data: ordersData } = useCustomerOrders(customer.id);
  const customerOrders: Order[] = ordersData?.data ?? [];
  const addLoyaltyPoints = useAddLoyaltyPoints();
  const updateCustomer = useUpdateCustomer();
  const { toast } = useToast();

  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ name: customer.name, email: customer.email ?? "", phone: customer.phone ?? "", address: customer.address ?? "", notes: customer.notes ?? "" });
  const [loyaltyForm, setLoyaltyForm] = useState({ points: "", type: "earn", reason: "" });

  const handleSave = async () => {
    try {
      await updateCustomer.mutateAsync({ id: customer.id, ...editForm });
      toast({ title: "Customer updated!" });
      setEditing(false);
    } catch {
      toast({ title: "Failed to update", variant: "destructive" });
    }
  };

  const handleAddPoints = async () => {
    if (!loyaltyForm.points) return;
    try {
      await addLoyaltyPoints.mutateAsync({ customerId: customer.id, points: Number(loyaltyForm.points), type: loyaltyForm.type, reason: loyaltyForm.reason });
      toast({ title: "Points updated!" });
      setLoyaltyForm({ points: "", type: "earn", reason: "" });
    } catch {
      toast({ title: "Failed to update points", variant: "destructive" });
    }
  };

  return (
    <div className="w-96 border-l border-border bg-card flex flex-col h-full overflow-hidden">
      <div className="p-4 border-b border-border flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center text-primary font-bold">
            {customer.name[0]}
          </div>
          <div>
            <p className="font-semibold text-sm">{customer.name}</p>
            <p className="text-xs text-muted-foreground">Since {formatDate(customer.createdAt)}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setEditing(!editing)}>
            <Pencil className="w-3.5 h-3.5" />
          </Button>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {editing ? (
          <div className="p-4 space-y-3">
            <h3 className="text-sm font-semibold">Edit Customer</h3>
            <div><Label>Name</Label><Input value={editForm.name} onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))} /></div>
            <div><Label>Email</Label><Input type="email" value={editForm.email} onChange={e => setEditForm(p => ({ ...p, email: e.target.value }))} /></div>
            <div><Label>Phone</Label><Input value={editForm.phone} onChange={e => setEditForm(p => ({ ...p, phone: e.target.value }))} /></div>
            <div><Label>Address</Label><Input value={editForm.address} onChange={e => setEditForm(p => ({ ...p, address: e.target.value }))} /></div>
            <div><Label>Notes</Label><Input value={editForm.notes} onChange={e => setEditForm(p => ({ ...p, notes: e.target.value }))} /></div>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1 h-8" onClick={() => setEditing(false)}>Cancel</Button>
              <Button className="flex-1 h-8" onClick={handleSave} disabled={updateCustomer.isPending}>Save</Button>
            </div>
          </div>
        ) : (
          <>
            <div className="p-4 grid grid-cols-3 gap-3">
              <div className="bg-muted/40 rounded-xl p-3 text-center">
                <p className="text-lg font-bold text-foreground">{customer.totalOrders}</p>
                <p className="text-xs text-muted-foreground">Orders</p>
              </div>
              <div className="bg-muted/40 rounded-xl p-3 text-center">
                <p className="text-sm font-bold text-foreground">₹{Number(customer.totalSpent).toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Spent</p>
              </div>
              <div className="bg-yellow-50 border border-yellow-100 rounded-xl p-3 text-center">
                <p className="text-lg font-bold text-yellow-600">{loyalty?.balance ?? customer.loyaltyPoints}</p>
                <p className="text-xs text-yellow-700">Points</p>
              </div>
            </div>

            <div className="px-4 pb-2 space-y-1.5">
              {customer.email && (
                <p className="text-xs text-muted-foreground flex items-center gap-2">
                  <Mail className="w-3.5 h-3.5 flex-shrink-0" />{customer.email}
                </p>
              )}
              {customer.phone && (
                <p className="text-xs text-muted-foreground flex items-center gap-2">
                  <Phone className="w-3.5 h-3.5 flex-shrink-0" />{customer.phone}
                </p>
              )}
              {customer.address && (
                <p className="text-xs text-muted-foreground flex items-center gap-2">
                  <MapPin className="w-3.5 h-3.5 flex-shrink-0" />{customer.address}
                </p>
              )}
              {customer.notes && (
                <p className="text-xs bg-muted/50 rounded-lg px-3 py-2 text-muted-foreground mt-2">{customer.notes}</p>
              )}
            </div>

            <div className="px-4 py-3 border-t border-border">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Loyalty Points</h3>
              <div className="space-y-2 mb-3">
                <div className="flex gap-2">
                  <button onClick={() => setLoyaltyForm(p => ({ ...p, type: "earn" }))} className={cn("flex-1 text-xs py-1.5 rounded-lg border", loyaltyForm.type === "earn" ? "bg-green-500 text-white border-green-500" : "border-border text-muted-foreground")}>
                    Earn
                  </button>
                  <button onClick={() => setLoyaltyForm(p => ({ ...p, type: "redeem" }))} className={cn("flex-1 text-xs py-1.5 rounded-lg border", loyaltyForm.type === "redeem" ? "bg-orange-500 text-white border-orange-500" : "border-border text-muted-foreground")}>
                    Redeem
                  </button>
                  <button onClick={() => setLoyaltyForm(p => ({ ...p, type: "adjust" }))} className={cn("flex-1 text-xs py-1.5 rounded-lg border", loyaltyForm.type === "adjust" ? "bg-blue-500 text-white border-blue-500" : "border-border text-muted-foreground")}>
                    Adjust
                  </button>
                </div>
                <Input type="number" min="0" placeholder="Points" value={loyaltyForm.points} onChange={e => setLoyaltyForm(p => ({ ...p, points: e.target.value }))} className="h-8 text-sm" />
                <Input placeholder="Reason (optional)" value={loyaltyForm.reason} onChange={e => setLoyaltyForm(p => ({ ...p, reason: e.target.value }))} className="h-8 text-sm" />
                <Button size="sm" className="w-full h-8" onClick={handleAddPoints} disabled={addLoyaltyPoints.isPending || !loyaltyForm.points}>
                  Update Points
                </Button>
              </div>
            </div>

            {loyalty?.transactions && loyalty.transactions.length > 0 && (
              <div className="px-4 pb-4 border-t border-border">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-3 mb-2">Point History</h3>
                <div className="space-y-2">
                  {loyalty.transactions.slice(0, 10).map((tx: LoyaltyTransaction) => (
                    <div key={tx.id} className="flex items-center justify-between gap-2 py-1.5 border-b border-border/30 last:border-0">
                      <div className="flex items-center gap-2">
                        <div className={cn("w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0", tx.points > 0 ? "bg-green-100 text-green-600" : "bg-red-100 text-red-600")}>
                          {tx.points > 0 ? <ArrowUpCircle className="w-3.5 h-3.5" /> : <ArrowDownCircle className="w-3.5 h-3.5" />}
                        </div>
                        <div>
                          <p className="text-xs font-medium capitalize">{tx.type}</p>
                          {tx.reason && <p className="text-[10px] text-muted-foreground">{tx.reason}</p>}
                          <p className="text-[10px] text-muted-foreground flex items-center gap-0.5"><Clock className="w-2.5 h-2.5" />{formatDateTime(tx.createdAt)}</p>
                        </div>
                      </div>
                      <span className={cn("text-sm font-bold", tx.points > 0 ? "text-green-600" : "text-red-600")}>
                        {tx.points > 0 ? "+" : ""}{tx.points}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {customerOrders.length > 0 && (
              <div className="px-4 pb-4 border-t border-border">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-3 mb-2">Order History</h3>
                <div className="space-y-2">
                  {customerOrders.map((order: Order) => (
                    <div key={order.id} className="flex items-start gap-2 py-2 border-b border-border/30 last:border-0">
                      <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <Receipt className="w-3.5 h-3.5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <p className="text-xs font-semibold">#{order.orderNumber}</p>
                          <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium", order.status === "completed" ? "bg-green-100 text-green-700" : order.status === "cancelled" ? "bg-red-100 text-red-700" : "bg-yellow-100 text-yellow-700")}>
                            {order.status}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground capitalize">{order.orderType?.replace("_", " ")}</p>
                        <div className="flex items-center justify-between mt-0.5">
                          <p className="text-[10px] text-muted-foreground flex items-center gap-0.5"><Clock className="w-2.5 h-2.5" />{formatDateTime(order.createdAt)}</p>
                          <p className="text-xs font-bold text-primary">₹{Number(order.totalAmount).toLocaleString()}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function CustomersTab() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", address: "", notes: "" });

  const { data: customersData } = useCustomers({ search: search || undefined, page });
  const customers: Customer[] = customersData?.data ?? [];
  const total: number = customersData?.total ?? 0;

  const createCustomer = useCreateCustomer();
  const { toast } = useToast();

  const handleAdd = async () => {
    if (!form.name) return;
    try {
      await createCustomer.mutateAsync(form);
      toast({ title: "Customer added!" });
      setShowAdd(false);
      setForm({ name: "", email: "", phone: "", address: "", notes: "" });
    } catch {
      toast({ title: "Failed to add customer", variant: "destructive" });
    }
  };

  return (
    <div className="flex gap-0 h-full">
      <div className={cn("flex-1 min-w-0", selectedCustomer && "hidden lg:block")}>
        <div className="flex gap-3 mb-4 items-center justify-between flex-wrap">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search customers..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="pl-9 w-56" />
          </div>
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <Plus className="w-4 h-4 mr-1.5" /> Add Customer
          </Button>
        </div>

        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Customer</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 hidden sm:table-cell">Contact</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 hidden md:table-cell">Orders</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 hidden md:table-cell">Total Spent</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 hidden lg:table-cell">Loyalty</th>
                <th className="text-right text-xs font-medium text-muted-foreground px-4 py-3">Details</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c: Customer) => (
                <tr
                  key={c.id}
                  className={cn("border-b border-border last:border-0 hover:bg-muted/10 cursor-pointer transition-colors", selectedCustomer?.id === c.id && "bg-primary/5 border-l-2 border-l-primary")}
                  onClick={() => setSelectedCustomer(selectedCustomer?.id === c.id ? null : c)}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center text-primary font-bold text-xs flex-shrink-0">
                        {c.name[0]}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{c.name}</p>
                        <p className="text-xs text-muted-foreground">Since {formatDate(c.createdAt)}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <div className="space-y-0.5">
                      {c.email && <p className="text-xs text-muted-foreground flex items-center gap-1"><Mail className="w-3 h-3" />{c.email}</p>}
                      {c.phone && <p className="text-xs text-muted-foreground flex items-center gap-1"><Phone className="w-3 h-3" />{c.phone}</p>}
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <div className="flex items-center gap-1 text-sm">
                      <ShoppingBag className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="font-medium">{c.totalOrders}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className="text-sm font-semibold">₹{Number(c.totalSpent).toLocaleString()}</span>
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    <div className="flex items-center gap-1 text-sm">
                      <Star className="w-3.5 h-3.5 text-yellow-500" />
                      <span>{c.loyaltyPoints} pts</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <ChevronRight className={cn("w-4 h-4 ml-auto text-muted-foreground transition-transform", selectedCustomer?.id === c.id && "rotate-90")} />
                  </td>
                </tr>
              ))}
              {customers.length === 0 && (
                <tr><td colSpan={6} className="text-center py-12 text-muted-foreground">
                  <Users className="w-10 h-10 mx-auto mb-2 opacity-20" />
                  No customers found
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        {total > 20 && (
          <div className="flex items-center justify-between mt-4">
            <p className="text-sm text-muted-foreground">Showing {customers.length} of {total}</p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
              <Button size="sm" variant="outline" disabled={page * 20 >= total} onClick={() => setPage(p => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </div>

      {selectedCustomer && (
        <CustomerDetailPanel
          key={selectedCustomer.id}
          customer={selectedCustomer}
          onClose={() => setSelectedCustomer(null)}
        />
      )}

      {showAdd && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Add Customer</h2>
              <button onClick={() => setShowAdd(false)} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <div><Label>Name *</Label><Input placeholder="Full name" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} /></div>
              <div><Label>Email</Label><Input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} /></div>
              <div><Label>Phone</Label><Input value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} /></div>
              <div><Label>Address</Label><Input value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} /></div>
              <div><Label>Notes</Label><Input value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} /></div>
              <div className="flex gap-3 pt-1">
                <Button variant="outline" className="flex-1" onClick={() => setShowAdd(false)}>Cancel</Button>
                <Button className="flex-1" onClick={handleAdd} disabled={createCustomer.isPending || !form.name}>Add</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CouponsTab() {
  const { data: coupons = [] } = useCoupons();
  const createCoupon = useCreateCoupon();
  const updateCoupon = useUpdateCoupon();
  const deleteCoupon = useDeleteCoupon();
  const { toast } = useToast();

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ code: "", discountType: "percentage" as "percentage" | "flat", discountValue: "", minOrderAmount: "", maxDiscountAmount: "", usageLimit: "", validFrom: "", validTo: "" });

  const handleCreate = async () => {
    if (!form.code || !form.discountValue) return;
    try {
      await createCoupon.mutateAsync({
        code: form.code,
        discountType: form.discountType,
        discountValue: form.discountValue,
        minOrderAmount: form.minOrderAmount || undefined,
        maxDiscountAmount: form.maxDiscountAmount || undefined,
        usageLimit: form.usageLimit ? Number(form.usageLimit) : undefined,
        validFrom: form.validFrom || undefined,
        validTo: form.validTo || undefined,
      });
      toast({ title: "Coupon created!" });
      setShowAdd(false);
      setForm({ code: "", discountType: "percentage", discountValue: "", minOrderAmount: "", maxDiscountAmount: "", usageLimit: "", validFrom: "", validTo: "" });
    } catch {
      toast({ title: "Failed to create coupon", variant: "destructive" });
    }
  };

  const handleToggle = async (c: Coupon) => {
    try {
      await updateCoupon.mutateAsync({ id: c.id, isActive: !c.isActive });
      toast({ title: c.isActive ? "Coupon deactivated" : "Coupon activated" });
    } catch {
      toast({ title: "Failed to update", variant: "destructive" });
    }
  };

  const handleDelete = async (c: Coupon) => {
    if (!confirm(`Delete coupon "${c.code}"?`)) return;
    try {
      await deleteCoupon.mutateAsync(c.id);
      toast({ title: "Coupon deleted" });
    } catch {
      toast({ title: "Failed to delete", variant: "destructive" });
    }
  };

  const isExpired = (c: Coupon) => c.validTo ? new Date(c.validTo) < new Date() : false;
  const isLimitReached = (c: Coupon) => c.usageLimit !== null && c.usageCount >= (c.usageLimit ?? 0);

  return (
    <div>
      <div className="flex justify-end mb-4">
        <Button size="sm" onClick={() => setShowAdd(true)}>
          <Plus className="w-4 h-4 mr-1.5" /> Create Coupon
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {(coupons as Coupon[]).map((c: Coupon) => {
          const expired = isExpired(c);
          const limitReached = isLimitReached(c);
          const effectivelyActive = c.isActive && !expired && !limitReached;

          return (
            <div key={c.id} className={cn("bg-card border rounded-xl p-4 relative overflow-hidden", effectivelyActive ? "border-border" : "border-border/50 opacity-70")}>
              <div className={cn("absolute top-0 left-0 right-0 h-1", effectivelyActive ? "bg-primary" : "bg-muted")} />
              <div className="flex items-start justify-between mb-3 mt-1">
                <div className="flex items-center gap-2">
                  <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", effectivelyActive ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                    <Tag className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="font-mono font-bold text-sm">{c.code}</p>
                    <p className="text-xs text-muted-foreground capitalize">{c.discountType} discount</p>
                  </div>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => handleToggle(c)} className={cn("text-xs px-2 py-0.5 rounded-full border font-medium", effectivelyActive ? "bg-green-100 text-green-700 border-green-200" : "bg-gray-100 text-gray-600 border-gray-200")}>
                    {effectivelyActive ? "Active" : expired ? "Expired" : limitReached ? "Used up" : "Inactive"}
                  </button>
                  <Button size="sm" variant="ghost" className="h-6 px-1.5 text-red-500 hover:text-red-600 hover:bg-red-50" onClick={() => handleDelete(c)}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Discount</span>
                  <span className="text-sm font-bold text-primary">
                    {c.discountType === "percentage" ? `${c.discountValue}%` : `₹${c.discountValue}`} off
                  </span>
                </div>
                {c.minOrderAmount && Number(c.minOrderAmount) > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Min order</span>
                    <span className="text-xs font-medium">₹{Number(c.minOrderAmount).toLocaleString()}</span>
                  </div>
                )}
                {c.maxDiscountAmount && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Max discount</span>
                    <span className="text-xs font-medium">₹{Number(c.maxDiscountAmount).toLocaleString()}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Used</span>
                  <span className="text-xs font-medium">{c.usageCount}{c.usageLimit ? ` / ${c.usageLimit}` : ""} times</span>
                </div>
                {c.validTo && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Valid until</span>
                    <span className={cn("text-xs font-medium", expired ? "text-red-500" : "")}>{formatDate(c.validTo)}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {(coupons as Coupon[]).length === 0 && (
          <div className="col-span-full text-center py-12 text-muted-foreground">
            <Gift className="w-10 h-10 mx-auto mb-2 opacity-20" />
            No coupons yet. Create your first discount code.
          </div>
        )}
      </div>

      {showAdd && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Create Coupon</h2>
              <button onClick={() => setShowAdd(false)} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <Label>Coupon Code *</Label>
                <Input
                  value={form.code}
                  onChange={e => setForm(p => ({ ...p, code: e.target.value.toUpperCase() }))}
                  placeholder="e.g. SAVE20"
                  className="font-mono uppercase"
                />
              </div>
              <div>
                <Label>Discount Type</Label>
                <div className="flex gap-2 mt-1">
                  {[{ k: "percentage", label: "Percentage (%)" }, { k: "flat", label: "Flat (₹)" }].map(({ k, label }) => (
                    <button key={k} onClick={() => setForm(p => ({ ...p, discountType: k as "percentage" | "flat" }))} className={cn("flex-1 text-sm py-2 rounded-lg border", form.discountType === k ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-muted/50")}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Label>Discount Value *</Label>
                <Input type="number" min="0" step="0.01" value={form.discountValue} onChange={e => setForm(p => ({ ...p, discountValue: e.target.value }))} placeholder={form.discountType === "percentage" ? "e.g. 20 for 20%" : "e.g. 50 for ₹50 off"} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Min Order Amount (₹)</Label><Input type="number" min="0" value={form.minOrderAmount} onChange={e => setForm(p => ({ ...p, minOrderAmount: e.target.value }))} placeholder="0" /></div>
                {form.discountType === "percentage" && (
                  <div><Label>Max Discount (₹)</Label><Input type="number" min="0" value={form.maxDiscountAmount} onChange={e => setForm(p => ({ ...p, maxDiscountAmount: e.target.value }))} placeholder="No cap" /></div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Usage Limit</Label><Input type="number" min="1" value={form.usageLimit} onChange={e => setForm(p => ({ ...p, usageLimit: e.target.value }))} placeholder="Unlimited" /></div>
                <div><Label>Valid Until</Label><Input type="date" value={form.validTo} onChange={e => setForm(p => ({ ...p, validTo: e.target.value }))} /></div>
              </div>
              <div className="flex gap-3 pt-1">
                <Button variant="outline" className="flex-1" onClick={() => setShowAdd(false)}>Cancel</Button>
                <Button className="flex-1" onClick={handleCreate} disabled={createCoupon.isPending || !form.code || !form.discountValue}>Create Coupon</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CustomersPage() {
  const [tab, setTab] = useState<Tab>("Customers");
  const { data: customersData } = useCustomers({});
  const total = customersData?.total ?? 0;

  return (
    <Layout>
      <PageHeader
        title="Customers"
        subtitle={`${total} registered customers`}
      />
      <div className="p-6 flex flex-col h-[calc(100vh-140px)]">
        <div className="flex gap-1 mb-6 bg-muted/40 rounded-xl p-1 w-fit flex-shrink-0">
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "px-4 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-2",
                tab === t ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t === "Customers" && <Users className="w-3.5 h-3.5" />}
              {t === "Coupons" && <Tag className="w-3.5 h-3.5" />}
              {t}
            </button>
          ))}
        </div>

        <div className="flex-1 min-h-0 flex">
          {tab === "Customers" && <CustomersTab />}
          {tab === "Coupons" && <div className="flex-1 overflow-y-auto"><CouponsTab /></div>}
        </div>
      </div>
    </Layout>
  );
}
