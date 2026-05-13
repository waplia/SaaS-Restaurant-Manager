import React, { createContext, useContext, useState, useCallback } from "react";

export interface CartItem {
  menuItemId: number;
  name: string;
  price: number;
  quantity: number;
  imageUrl?: string | null;
}

interface CartState {
  restaurantId: number | null;
  tableId: number | null;
  tableToken: string | null;
  items: CartItem[];
}

interface CartContextType {
  cart: CartState;
  setTable: (restaurantId: number, tableId: number, token: string) => void;
  addItem: (item: Omit<CartItem, "quantity">) => void;
  removeItem: (menuItemId: number) => void;
  updateQuantity: (menuItemId: number, delta: number) => void;
  clearCart: () => void;
  total: number;
  itemCount: number;
}

const CartContext = createContext<CartContextType | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [cart, setCart] = useState<CartState>({
    restaurantId: null,
    tableId: null,
    tableToken: null,
    items: [],
  });

  const setTable = useCallback((restaurantId: number, tableId: number, token: string) => {
    setCart({ restaurantId, tableId, tableToken: token, items: [] });
  }, []);

  const addItem = useCallback((item: Omit<CartItem, "quantity">) => {
    setCart((prev) => {
      const existing = prev.items.find((i) => i.menuItemId === item.menuItemId);
      if (existing) {
        return {
          ...prev,
          items: prev.items.map((i) =>
            i.menuItemId === item.menuItemId ? { ...i, quantity: i.quantity + 1 } : i
          ),
        };
      }
      return { ...prev, items: [...prev.items, { ...item, quantity: 1 }] };
    });
  }, []);

  const removeItem = useCallback((menuItemId: number) => {
    setCart((prev) => ({ ...prev, items: prev.items.filter((i) => i.menuItemId !== menuItemId) }));
  }, []);

  const updateQuantity = useCallback((menuItemId: number, delta: number) => {
    setCart((prev) => {
      const items = prev.items
        .map((i) => (i.menuItemId === menuItemId ? { ...i, quantity: i.quantity + delta } : i))
        .filter((i) => i.quantity > 0);
      return { ...prev, items };
    });
  }, []);

  const clearCart = useCallback(() => {
    setCart((prev) => ({ ...prev, items: [] }));
  }, []);

  const total = cart.items.reduce((s, i) => s + i.price * i.quantity, 0);
  const itemCount = cart.items.reduce((s, i) => s + i.quantity, 0);

  return (
    <CartContext.Provider value={{ cart, setTable, addItem, removeItem, updateQuantity, clearCart, total, itemCount }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
