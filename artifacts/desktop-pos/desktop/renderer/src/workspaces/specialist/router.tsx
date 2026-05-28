/**
 * Resolves a nav item to its specialist screen component.
 *
 * Used by `WorkspaceRouter` to feed `renderModule` into `DesktopShell`.
 * Returning `null` falls through to the shell's generic "coming soon"
 * empty state.
 */
import type { NavItem, WorkspaceKey } from "../types";
import { SyncCenter } from "./shared";
import * as Inv from "./inventory";
import * as Acc from "./accounts";
import * as Mkt from "./marketing";
import * as Del from "./delivery";

type Renderer = (() => React.ReactNode) | React.ReactNode;

function r(node: React.ReactNode): Renderer { return () => node; }

const INVENTORY: Record<string, Renderer> = {
  "raw-materials":    r(<Inv.RawMaterialsScreen />),
  "menu-item-stock":  r(<Inv.MenuItemStockScreen />),
  "low-stock":        r(<Inv.LowStockScreen />),
  "warehouse":        r(<Inv.WarehouseScreen />),
  "warehouse-type":   r(<Inv.WarehouseTypeScreen />),
  "stock-transfer":   r(<Inv.StockTransferScreen />),
  "suppliers":        r(<Inv.SuppliersScreen />),
  "purchase":         r(<Inv.PurchaseOrdersScreen />),
  "vendor-ocr":       r(<Inv.VendorOcrScreen />),
  "wastage":          r(<Inv.WastageScreen />),
  "reports":          r(<Inv.InventoryReportsScreen />),
  "sync-center":      r(<SyncCenter />),
};

const ACCOUNTANT: Record<string, Renderer> = {
  "payments":             r(<Acc.PaymentsLedgerScreen />),
  "voucher":              r(<Acc.VoucherScreen />),
  "expense-types":        r(<Acc.ExpenseTypesScreen />),
  "expenses":             r(<Acc.ExpensesScreen />),
  "cards":                r(<Acc.CardsScreen />),
  "wallet":               r(<Acc.WalletScreen />),
  "bank-recon":           r(<Acc.BankReconciliationScreen />),
  "refunds":              r(<Acc.RefundsScreen />),
  "settlements":          r(<Acc.SettlementsScreen />),
  "accounting-reports":   r(<Acc.AccountingReportsScreen />),
  "pos-report":           r(<Acc.PosReportScreen />),
  "work-period":          r(<Acc.WorkPeriodScreen />),
  "pnl":                  r(<Acc.PnlScreen />),
  "sync-center":          r(<SyncCenter />),
};

const MARKETING: Record<string, Renderer> = {
  "growth-engine":       r(<Mkt.GrowthEngineScreen />),
  "campaigns":           r(<Mkt.CampaignsScreen />),
  "whatsapp-campaigns":  r(<Mkt.CampaignsScreen channelFilter="whatsapp" title="WhatsApp campaigns" />),
  "sms-campaigns":       r(<Mkt.CampaignsScreen channelFilter="sms" title="SMS campaigns" />),
  "email-campaigns":     r(<Mkt.CampaignsScreen channelFilter="email" title="Email campaigns" />),
  "push-campaigns":      r(<Mkt.CampaignsScreen channelFilter="push" title="Push campaigns" />),
  "templates":           r(<Mkt.TemplatesScreen channel="email" title="Templates" />),
  "email-templates":     r(<Mkt.TemplatesScreen channel="email" title="Email templates" />),
  "whatsapp-templates":  r(<Mkt.TemplatesScreen channel="whatsapp" title="WhatsApp templates" />),
  "coupons":             r(<Mkt.CouponsScreen />),
  "segments":            r(<Mkt.SegmentsScreen />),
  "reviews":             r(<Mkt.ReviewsScreen />),
  "sync-center":         r(<SyncCenter />),
};

const DELIVERY: Record<string, Renderer> = {
  "assignments":        r(<Del.AssignmentsScreen />),
  "status-board":       r(<Del.StatusBoardScreen />),
  "riders":             r(<Del.RidersScreen />),
  "cod-collection":     r(<Del.CodCollectionScreen />),
  "cash-handover":      r(<Del.CashHandoverScreen />),
  "delivery-reports":   r(<Del.DeliveryReportsScreen />),
  "sync-center":        r(<SyncCenter />),
};

const RESOLVERS: Partial<Record<WorkspaceKey, Record<string, Renderer>>> = {
  inventory:  INVENTORY,
  accountant: ACCOUNTANT,
  marketing:  MARKETING,
  delivery:   DELIVERY,
};

export function renderSpecialistModule(workspaceKey: WorkspaceKey, item: NavItem): React.ReactNode {
  const map = RESOLVERS[workspaceKey];
  if (!map) return null;
  const entry = map[item.key];
  if (!entry) return null;
  return typeof entry === "function" ? (entry as () => React.ReactNode)() : entry;
}
