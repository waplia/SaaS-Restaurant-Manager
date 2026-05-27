export interface InventoryItem {
  id: number;
  name: string;
  unit?: string;
  currentStock?: number | string;
  minStockLevel?: number | string;
  costPerUnit?: number | string;
  category?: string | null;
  supplierId?: number | null;
  isLowStock?: boolean;
}

export interface PurchaseOrderLine {
  id: number;
  purchaseOrderId: number;
  inventoryItemId: number | null;
  itemName?: string | null;
  quantity: string | number;
  receivedQuantity?: string | number | null;
  unit?: string | null;
  costPerUnit: string | number;
  totalPrice?: string | number;
}

export interface PurchaseOrder {
  id: number;
  restaurantId: number;
  supplierId?: number | null;
  status: string;
  totalAmount: string | number;
  paidAmount?: string | number;
  notes?: string | null;
  orderedAt?: string | null;
  receivedAt?: string | null;
  items?: PurchaseOrderLine[];
}

export interface Supplier {
  id: number;
  name: string;
  contactPerson?: string | null;
  phone?: string | null;
  isActive?: boolean;
}

export interface AuthOutletLite {
  id: number;
  name: string;
}
