import { db } from "./lib/db";
import {
  subscriptionPlansTable,
  tenantsTable,
  restaurantsTable,
  branchesTable,
  usersTable,
  floorTablesTable,
  menusTable,
  menuCategoriesTable,
  menuItemsTable,
  inventoryItemsTable,
  suppliersTable,
  customersTable,
  ordersTable,
  orderItemsTable,
  kitchenTicketsTable,
  notificationsTable,
} from "./lib/db";
import { eq } from "drizzle-orm";

export async function seed(): Promise<void> {
  console.log("🌱 Starting seed...");

  // ── Subscription Plans ──────────────────────────────────────
  await Promise.all([
    db.insert(subscriptionPlansTable).values({
      name: "Free Trial", slug: "free-trial", price: "0.00", billingPeriod: "monthly",
      maxRestaurants: 1, maxBranches: 1, maxStaff: 3, maxTables: 5, maxMenuItems: 20, trialDays: 14,
      features: ["POS", "Basic Reports"],
    }).onConflictDoNothing(),
    db.insert(subscriptionPlansTable).values({
      name: "Starter", slug: "starter", price: "29.00", billingPeriod: "monthly",
      maxRestaurants: 1, maxBranches: 1, maxStaff: 5, maxTables: 10, maxMenuItems: 50, trialDays: 14,
      features: ["POS", "QR Ordering", "Basic Reports"],
    }).onConflictDoNothing(),
    db.insert(subscriptionPlansTable).values({
      name: "Pro", slug: "pro", price: "79.00", billingPeriod: "monthly",
      maxRestaurants: 3, maxBranches: 5, maxStaff: 25, maxTables: 50, maxMenuItems: 300, trialDays: 14,
      features: ["POS", "QR Ordering", "Kitchen Display", "Inventory", "Advanced Reports", "Multi-branch"],
    }).onConflictDoNothing(),
    db.insert(subscriptionPlansTable).values({
      name: "Enterprise", slug: "enterprise", price: "199.00", billingPeriod: "monthly",
      maxRestaurants: -1, maxBranches: -1, maxStaff: -1, maxTables: -1, maxMenuItems: -1, trialDays: 30,
      features: ["All Pro features", "White-label", "API Access", "Dedicated Support"],
    }).onConflictDoNothing(),
  ]);

  const starterPlan = await db.select().from(subscriptionPlansTable).where(eq(subscriptionPlansTable.slug, "starter")).then(r => r[0]);
  const proPlan = await db.select().from(subscriptionPlansTable).where(eq(subscriptionPlansTable.slug, "pro")).then(r => r[0]);

  if (!starterPlan || !proPlan) throw new Error("Failed to create/find plans");
  console.log("✅ Plans created");

  // ── Tenants ─────────────────────────────────────────────────
  const [spiceTenant] = await db.insert(tenantsTable).values({
    name: "Spice Garden Restaurants", slug: "spice-garden",
    planId: proPlan.id, planStatus: "active", primaryColor: "#f97316",
  }).onConflictDoNothing().returning();

  const [burgerTenant] = await db.insert(tenantsTable).values({
    name: "Burger Barn Chain", slug: "burger-barn",
    planId: starterPlan.id, planStatus: "trial",
    trialEndsAt: new Date(Date.now() + 10 * 86400000), primaryColor: "#dc2626",
  }).onConflictDoNothing().returning();

  const spiceTenantId = spiceTenant?.id ?? (await db.select().from(tenantsTable).where(eq(tenantsTable.slug, "spice-garden")))[0]?.id;
  const burgerTenantId = burgerTenant?.id ?? (await db.select().from(tenantsTable).where(eq(tenantsTable.slug, "burger-barn")))[0]?.id;

  if (!spiceTenantId || !burgerTenantId) throw new Error("Failed to create/find tenants");
  console.log("✅ Tenants created");

  // ── Restaurants ─────────────────────────────────────────────
  const [spiceRest] = await db.insert(restaurantsTable).values({
    tenantId: spiceTenantId, name: "Spice Garden", slug: "spice-garden-main",
    description: "Authentic Indian cuisine with a modern twist",
    phone: "+91 98765 43210", email: "hello@spicegarden.com",
    address: "12 MG Road", city: "Bangalore", country: "IN",
    taxRate: "5.00", serviceCharge: "10.00",
    openingTime: "10:00", closingTime: "23:00",
  }).onConflictDoNothing().returning();

  await db.insert(restaurantsTable).values({
    tenantId: burgerTenantId, name: "Burger Barn", slug: "burger-barn-main",
    description: "Juicy burgers, crispy fries, great vibes",
    phone: "+91 99887 76655", email: "hi@burgerbarn.com",
    address: "5 Connaught Place", city: "Delhi", country: "IN",
    taxRate: "5.00", serviceCharge: "0.00",
    openingTime: "11:00", closingTime: "22:00",
  }).onConflictDoNothing();

  const spiceRestId = spiceRest?.id ?? (await db.select().from(restaurantsTable).where(eq(restaurantsTable.slug, "spice-garden-main")))[0]?.id;
  if (!spiceRestId) throw new Error("Failed to create/find Spice Garden restaurant");
  console.log("✅ Restaurants created");

  // ── Branches ────────────────────────────────────────────────
  await db.insert(branchesTable).values({ restaurantId: spiceRestId, name: "MG Road", address: "12 MG Road, Bangalore", isMain: true }).onConflictDoNothing();
  await db.insert(branchesTable).values({ restaurantId: spiceRestId, name: "Koramangala", address: "5th Block, Koramangala" }).onConflictDoNothing();

  // ── Users ────────────────────────────────────────────────────
  await db.insert(usersTable).values({
    name: "Alex Super", email: "admin@tabletrack.io",
    passwordHash: "demo_hash_super", role: "super_admin", isSuperAdmin: true,
  }).onConflictDoNothing();

  await db.insert(usersTable).values({
    name: "Priya Sharma", email: "priya@spicegarden.com",
    passwordHash: "demo_hash_owner1", role: "owner",
    tenantId: spiceTenantId, restaurantId: spiceRestId, phone: "+91 98765 43210",
  }).onConflictDoNothing();

  await db.insert(usersTable).values({
    name: "Amit Patel", email: "amit@spicegarden.com",
    passwordHash: "demo_hash_waiter1", role: "waiter",
    tenantId: spiceTenantId, restaurantId: spiceRestId, phone: "+91 90000 11111",
  }).onConflictDoNothing();

  await db.insert(usersTable).values({
    name: "Sunita Devi", email: "sunita@spicegarden.com",
    passwordHash: "demo_hash_waiter2", role: "waiter",
    tenantId: spiceTenantId, restaurantId: spiceRestId, phone: "+91 90000 22222",
  }).onConflictDoNothing();

  await db.insert(usersTable).values({
    name: "Chef Ramesh", email: "ramesh@spicegarden.com",
    passwordHash: "demo_hash_chef1", role: "kitchen",
    tenantId: spiceTenantId, restaurantId: spiceRestId, phone: "+91 90000 33333",
  }).onConflictDoNothing();

  await db.insert(usersTable).values({
    name: "Deepa Nair", email: "deepa@spicegarden.com",
    passwordHash: "demo_hash_manager1", role: "manager",
    tenantId: spiceTenantId, restaurantId: spiceRestId, phone: "+91 90000 44444",
  }).onConflictDoNothing();

  console.log("✅ Users created");

  // ── Floor Tables ─────────────────────────────────────────────
  const tableData = [
    { tableNumber: "T1", capacity: 2, positionX: 50, positionY: 50, shape: "round", status: "occupied" },
    { tableNumber: "T2", capacity: 4, positionX: 150, positionY: 50, shape: "square" },
    { tableNumber: "T3", capacity: 4, positionX: 250, positionY: 50, shape: "square" },
    { tableNumber: "T4", capacity: 6, positionX: 50, positionY: 150, shape: "rectangle", status: "reserved" },
    { tableNumber: "T5", capacity: 4, positionX: 150, positionY: 150, shape: "square", status: "occupied" },
    { tableNumber: "T6", capacity: 2, positionX: 250, positionY: 150, shape: "round" },
    { tableNumber: "T7", capacity: 8, positionX: 50, positionY: 250, shape: "rectangle" },
    { tableNumber: "T8", capacity: 4, positionX: 200, positionY: 250, shape: "square" },
    { tableNumber: "BAR1", capacity: 1, positionX: 350, positionY: 50, shape: "round" },
    { tableNumber: "BAR2", capacity: 1, positionX: 350, positionY: 100, shape: "round" },
  ] as const;

  const tableIds: number[] = [];
  for (const t of tableData) {
    const qrCode = `spice-${t.tableNumber}-${Date.now()}`;
    const [tbl] = await db.insert(floorTablesTable).values({ restaurantId: spiceRestId, ...t, qrCode }).onConflictDoNothing().returning();
    if (tbl) tableIds.push(tbl.id);
  }

  console.log("✅ Tables created");

  // ── Menu ─────────────────────────────────────────────────────
  const [menu] = await db.insert(menusTable).values({
    restaurantId: spiceRestId, name: "Main Menu",
    description: "Our full menu", availableFrom: "10:00", availableTo: "23:00",
  }).onConflictDoNothing().returning();

  const menuId = menu?.id ?? (await db.select().from(menusTable).where(eq(menusTable.restaurantId, spiceRestId)))[0]?.id;
  if (!menuId) throw new Error("Failed to create/find menu");

  const [startersCat] = await db.insert(menuCategoriesTable).values({ menuId, restaurantId: spiceRestId, name: "Starters", sortOrder: 1 }).onConflictDoNothing().returning();
  const [mainCat] = await db.insert(menuCategoriesTable).values({ menuId, restaurantId: spiceRestId, name: "Main Course", sortOrder: 2 }).onConflictDoNothing().returning();
  const [breadCat] = await db.insert(menuCategoriesTable).values({ menuId, restaurantId: spiceRestId, name: "Breads & Rice", sortOrder: 3 }).onConflictDoNothing().returning();
  const [drinksCat] = await db.insert(menuCategoriesTable).values({ menuId, restaurantId: spiceRestId, name: "Beverages", sortOrder: 4 }).onConflictDoNothing().returning();
  const [dessertCat] = await db.insert(menuCategoriesTable).values({ menuId, restaurantId: spiceRestId, name: "Desserts", sortOrder: 5 }).onConflictDoNothing().returning();

  const existingCats = await db.select().from(menuCategoriesTable).where(eq(menuCategoriesTable.menuId, menuId));
  const getCat = (name: string): number => {
    const c = existingCats.find(c => c.name === name);
    return c?.id ?? (startersCat?.id ?? existingCats[0]!.id);
  };

  interface MenuItemSeed {
    categoryId: number;
    name: string;
    description: string;
    price: string;
    isVeg: boolean;
    preparationTime: number;
    calories?: number;
    tags: string[];
  }

  const menuItems: MenuItemSeed[] = [
    { categoryId: getCat("Starters"), name: "Samosa (2 pcs)", description: "Crispy fried pastry with spiced potato filling", price: "80.00", isVeg: true, preparationTime: 10, calories: 150, tags: ["popular", "vegetarian"] },
    { categoryId: getCat("Starters"), name: "Paneer Tikka", description: "Marinated paneer grilled in tandoor", price: "220.00", isVeg: true, preparationTime: 15, calories: 300, tags: ["popular", "vegetarian"] },
    { categoryId: getCat("Starters"), name: "Chicken Tikka", description: "Marinated chicken grilled in tandoor", price: "280.00", isVeg: false, preparationTime: 20, calories: 350, tags: ["popular", "spicy"] },
    { categoryId: getCat("Starters"), name: "Veg Spring Rolls", description: "Crispy rolls with mixed vegetable filling", price: "160.00", isVeg: true, preparationTime: 12, calories: 200, tags: ["vegetarian"] },
    { categoryId: getCat("Starters"), name: "Soup of the Day", description: "Chef's special soup", price: "120.00", isVeg: true, preparationTime: 8, calories: 100, tags: [] },

    { categoryId: getCat("Main Course"), name: "Butter Chicken", description: "Tender chicken in rich tomato butter gravy", price: "320.00", isVeg: false, preparationTime: 20, calories: 450, tags: ["bestseller", "spicy"] },
    { categoryId: getCat("Main Course"), name: "Paneer Butter Masala", description: "Cottage cheese in creamy tomato gravy", price: "260.00", isVeg: true, preparationTime: 18, calories: 400, tags: ["bestseller", "vegetarian"] },
    { categoryId: getCat("Main Course"), name: "Dal Makhani", description: "Slow-cooked black lentils with cream and butter", price: "200.00", isVeg: true, preparationTime: 25, calories: 350, tags: ["popular", "vegetarian"] },
    { categoryId: getCat("Main Course"), name: "Chicken Biryani", description: "Fragrant basmati rice with spiced chicken", price: "380.00", isVeg: false, preparationTime: 30, calories: 600, tags: ["bestseller"] },
    { categoryId: getCat("Main Course"), name: "Veg Biryani", description: "Fragrant basmati rice with mixed vegetables", price: "280.00", isVeg: true, preparationTime: 25, calories: 500, tags: ["popular", "vegetarian"] },
    { categoryId: getCat("Main Course"), name: "Palak Paneer", description: "Cottage cheese in spiced spinach gravy", price: "240.00", isVeg: true, preparationTime: 20, calories: 380, tags: ["healthy", "vegetarian"] },
    { categoryId: getCat("Main Course"), name: "Fish Curry", description: "Coastal style fish in coconut gravy", price: "360.00", isVeg: false, preparationTime: 22, calories: 420, tags: ["spicy"] },

    { categoryId: getCat("Breads & Rice"), name: "Naan", description: "Soft leavened bread from tandoor", price: "50.00", isVeg: true, preparationTime: 8, calories: 120, tags: [] },
    { categoryId: getCat("Breads & Rice"), name: "Butter Naan", description: "Naan brushed with butter", price: "60.00", isVeg: true, preparationTime: 8, calories: 140, tags: ["popular"] },
    { categoryId: getCat("Breads & Rice"), name: "Garlic Naan", description: "Naan topped with garlic and herbs", price: "70.00", isVeg: true, preparationTime: 10, calories: 150, tags: ["popular"] },
    { categoryId: getCat("Breads & Rice"), name: "Tandoori Roti", description: "Whole wheat bread from tandoor", price: "40.00", isVeg: true, preparationTime: 6, calories: 90, tags: ["healthy"] },
    { categoryId: getCat("Breads & Rice"), name: "Steamed Rice", description: "Plain basmati rice", price: "80.00", isVeg: true, preparationTime: 15, calories: 200, tags: [] },

    { categoryId: getCat("Beverages"), name: "Sweet Lassi", description: "Chilled sweet yogurt drink", price: "80.00", isVeg: true, preparationTime: 5, calories: 200, tags: ["popular"] },
    { categoryId: getCat("Beverages"), name: "Mango Lassi", description: "Chilled mango yogurt drink", price: "100.00", isVeg: true, preparationTime: 5, calories: 250, tags: ["popular"] },
    { categoryId: getCat("Beverages"), name: "Masala Chai", description: "Spiced Indian tea with milk", price: "60.00", isVeg: true, preparationTime: 5, calories: 80, tags: [] },
    { categoryId: getCat("Beverages"), name: "Fresh Lime Soda", description: "Freshly squeezed lime with soda", price: "70.00", isVeg: true, preparationTime: 3, calories: 50, tags: [] },
    { categoryId: getCat("Beverages"), name: "Mineral Water", description: "500ml bottled water", price: "40.00", isVeg: true, preparationTime: 1, calories: 0, tags: [] },

    { categoryId: getCat("Desserts"), name: "Gulab Jamun", description: "Soft milk dumplings in sugar syrup", price: "100.00", isVeg: true, preparationTime: 5, calories: 250, tags: ["popular"] },
    { categoryId: getCat("Desserts"), name: "Kheer", description: "Creamy rice pudding with cardamom", price: "120.00", isVeg: true, preparationTime: 5, calories: 300, tags: [] },
    { categoryId: getCat("Desserts"), name: "Ice Cream", description: "Two scoops — vanilla, chocolate, or mango", price: "140.00", isVeg: true, preparationTime: 3, calories: 280, tags: [] },
  ];

  const insertedItems: Array<typeof menuItemsTable.$inferSelect> = [];
  for (const item of menuItems) {
    const [mi] = await db.insert(menuItemsTable).values({ ...item, restaurantId: spiceRestId }).onConflictDoNothing().returning();
    if (mi) insertedItems.push(mi);
  }

  console.log("✅ Menu created");

  // ── Inventory ────────────────────────────────────────────────
  const [supplier1] = await db.insert(suppliersTable).values({ restaurantId: spiceRestId, name: "Fresh Farm Supplies", contactPerson: "Venkat Rao", phone: "+91 80000 12345", email: "venkat@freshfarm.com" }).onConflictDoNothing().returning();

  const inventoryItems = [
    { name: "Chicken", unit: "kg", currentStock: "25.000", minStockLevel: "10.000", costPerUnit: "180.00", category: "proteins" },
    { name: "Paneer", unit: "kg", currentStock: "8.000", minStockLevel: "5.000", costPerUnit: "280.00", category: "dairy" },
    { name: "Basmati Rice", unit: "kg", currentStock: "50.000", minStockLevel: "20.000", costPerUnit: "85.00", category: "grains" },
    { name: "Tomatoes", unit: "kg", currentStock: "15.000", minStockLevel: "8.000", costPerUnit: "30.00", category: "vegetables" },
    { name: "Onions", unit: "kg", currentStock: "20.000", minStockLevel: "10.000", costPerUnit: "25.00", category: "vegetables" },
    { name: "Butter", unit: "kg", currentStock: "3.000", minStockLevel: "2.000", costPerUnit: "450.00", category: "dairy" },
    { name: "Cooking Oil", unit: "litre", currentStock: "12.000", minStockLevel: "5.000", costPerUnit: "120.00", category: "oils" },
    { name: "Whole Wheat Flour", unit: "kg", currentStock: "2.000", minStockLevel: "5.000", costPerUnit: "40.00", category: "grains" },
    { name: "Cream", unit: "litre", currentStock: "4.000", minStockLevel: "3.000", costPerUnit: "200.00", category: "dairy" },
    { name: "Spice Mix", unit: "kg", currentStock: "1.500", minStockLevel: "1.000", costPerUnit: "300.00", category: "spices" },
    { name: "Lentils (Dal)", unit: "kg", currentStock: "15.000", minStockLevel: "5.000", costPerUnit: "90.00", category: "grains" },
    { name: "Fish (Fresh)", unit: "kg", currentStock: "0.800", minStockLevel: "3.000", costPerUnit: "250.00", category: "proteins" },
  ];

  for (const inv of inventoryItems) {
    await db.insert(inventoryItemsTable).values({ ...inv, restaurantId: spiceRestId, supplierId: supplier1?.id }).onConflictDoNothing();
  }

  console.log("✅ Inventory created");

  // ── Customers ─────────────────────────────────────────────────
  const customerData = [
    { name: "Rahul Mehta", email: "rahul@gmail.com", phone: "+91 98001 11111", loyaltyPoints: 450, totalOrders: 12, totalSpent: "4800.00" },
    { name: "Anjali Singh", email: "anjali@gmail.com", phone: "+91 98002 22222", loyaltyPoints: 800, totalOrders: 22, totalSpent: "8900.00" },
    { name: "Vikram Shah", email: "vikram@gmail.com", phone: "+91 98003 33333", loyaltyPoints: 200, totalOrders: 6, totalSpent: "2400.00" },
    { name: "Meena Iyer", phone: "+91 98004 44444", loyaltyPoints: 0, totalOrders: 2, totalSpent: "700.00" },
    { name: "Karan Bose", email: "karan@gmail.com", loyaltyPoints: 1200, totalOrders: 35, totalSpent: "14000.00" },
  ];
  for (const c of customerData) {
    await db.insert(customersTable).values({ restaurantId: spiceRestId, ...c }).onConflictDoNothing();
  }

  console.log("✅ Customers created");

  // ── Orders ───────────────────────────────────────────────────
  const item1 = insertedItems.find(i => i.name === "Butter Chicken");
  const item2 = insertedItems.find(i => i.name === "Butter Naan");
  const item3 = insertedItems.find(i => i.name === "Paneer Tikka");
  const item4 = insertedItems.find(i => i.name === "Mango Lassi");
  const item5 = insertedItems.find(i => i.name === "Dal Makhani");
  const [t1Id, t2Id] = tableIds;

  if (item1 && item2 && t1Id) {
    const subtotal = Number(item1.price) * 2 + Number(item2.price) * 3;
    const tax = subtotal * 0.05;
    const service = subtotal * 0.10;
    const [order1] = await db.insert(ordersTable).values({
      restaurantId: spiceRestId, tableId: t1Id, orderNumber: "ORD-DEMO001",
      orderType: "dine_in", status: "confirmed",
      subtotal: subtotal.toFixed(2), taxAmount: tax.toFixed(2),
      serviceCharge: service.toFixed(2), totalAmount: (subtotal + tax + service).toFixed(2),
      customerName: "Rahul Mehta",
    }).onConflictDoNothing().returning();
    if (order1) {
      await db.insert(orderItemsTable).values([
        { orderId: order1.id, menuItemId: item1.id, menuItemName: item1.name, quantity: 2, unitPrice: item1.price, totalPrice: (Number(item1.price) * 2).toFixed(2) },
        { orderId: order1.id, menuItemId: item2.id, menuItemName: item2.name, quantity: 3, unitPrice: item2.price, totalPrice: (Number(item2.price) * 3).toFixed(2) },
      ]).onConflictDoNothing();
      await db.insert(kitchenTicketsTable).values({ orderId: order1.id, restaurantId: spiceRestId, status: "preparing" }).onConflictDoNothing();
    }
  }

  if (item3 && item4 && item5 && t2Id) {
    const subtotal = Number(item3.price) + Number(item4.price) * 2 + Number(item5.price);
    const tax = subtotal * 0.05;
    const service = subtotal * 0.10;
    const [order2] = await db.insert(ordersTable).values({
      restaurantId: spiceRestId, tableId: t2Id, orderNumber: "ORD-DEMO002",
      orderType: "dine_in", status: "pending", isPriority: true,
      subtotal: subtotal.toFixed(2), taxAmount: tax.toFixed(2),
      serviceCharge: service.toFixed(2), totalAmount: (subtotal + tax + service).toFixed(2),
    }).onConflictDoNothing().returning();
    if (order2) {
      await db.insert(orderItemsTable).values([
        { orderId: order2.id, menuItemId: item3.id, menuItemName: item3.name, quantity: 1, unitPrice: item3.price, totalPrice: item3.price },
        { orderId: order2.id, menuItemId: item4.id, menuItemName: item4.name, quantity: 2, unitPrice: item4.price, totalPrice: (Number(item4.price) * 2).toFixed(2) },
        { orderId: order2.id, menuItemId: item5.id, menuItemName: item5.name, quantity: 1, unitPrice: item5.price, totalPrice: item5.price },
      ]).onConflictDoNothing();
      await db.insert(kitchenTicketsTable).values({ orderId: order2.id, restaurantId: spiceRestId, status: "new", isPriority: true }).onConflictDoNothing();
    }
  }

  // Historical orders for reports
  const now = new Date();
  for (let d = 1; d <= 14; d++) {
    const orderDate = new Date(now.getTime() - d * 86400000);
    const count = 3 + Math.floor(Math.random() * 8);
    for (let i = 0; i < count; i++) {
      const subtotal = 300 + Math.random() * 700;
      const tax = subtotal * 0.05;
      const service = subtotal * 0.10;
      await db.insert(ordersTable).values({
        restaurantId: spiceRestId,
        orderNumber: `ORD-HIST-${d}-${i}`,
        orderType: "dine_in", status: "completed", paymentStatus: "paid", paymentMethod: "cash",
        subtotal: subtotal.toFixed(2), taxAmount: tax.toFixed(2),
        serviceCharge: service.toFixed(2), totalAmount: (subtotal + tax + service).toFixed(2),
        createdAt: orderDate, updatedAt: orderDate,
      }).onConflictDoNothing();
    }
  }

  console.log("✅ Orders created");

  // ── Notifications ─────────────────────────────────────────────
  await db.insert(notificationsTable).values([
    { restaurantId: spiceRestId, type: "new_order", title: "New Order", message: "Table T1 placed a new order (ORD-DEMO001)" },
    { restaurantId: spiceRestId, type: "low_stock", title: "Low Stock Alert", message: "Whole Wheat Flour is running low (2 kg remaining)" },
    { restaurantId: spiceRestId, type: "low_stock", title: "Low Stock Alert", message: "Fish (Fresh) is critically low (0.8 kg remaining)" },
    { restaurantId: spiceRestId, type: "waiter_call", title: "Waiter Called", message: "Table T5 is calling for a waiter" },
    { restaurantId: spiceRestId, type: "reservation", title: "New Reservation", message: "Reservation for 4 people at 7:30 PM by Anjali Singh" },
  ]).onConflictDoNothing();

  console.log("✅ Notifications created");
  console.log("🎉 Seed complete!");
  console.log("Restaurant ID (Spice Garden):", spiceRestId);
}
