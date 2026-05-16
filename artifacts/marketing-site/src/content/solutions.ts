import {
  Utensils, Coffee, ChefHat, Cake, Beer, Hotel, ShoppingCart, Soup, Calendar,
  Building2, Building, School, AlertTriangle, Clock, IndianRupee, Users,
  TrendingUp, Truck, BookOpen, Star,
  type LucideIcon,
} from "lucide-react";
import type { SolutionPageContent } from "@/components/templates/SolutionPage";

const m = (name: string, href: string, desc: string) => ({ name, href, desc });

const PROBLEM = (items: { title: string; desc: string; icon?: LucideIcon }[]) =>
  items.map(it => ({ ...it, icon: it.icon ?? AlertTriangle }));

const COMMON_FAQ = (label: string) => [
  { q: `Is KhanaLagao really purpose-built for ${label.toLowerCase()}?`, a: `Yes. Every module — POS, KDS, inventory, growth — has ${label.toLowerCase()}-specific workflows. We didn't bolt features on; we built them in.` },
  { q: "How long does setup take?", a: "Most single outlets are live in under a week with full menu, hardware, staff training and live support during your first service." },
  { q: "Do you support multi-outlet brands?", a: "Yes — centralized menus, outlet-level overrides, consolidated reporting and role-based access are built in from day one." },
  { q: "Does it work offline?", a: "Yes. KhanaLagao keeps billing, KOTs and orders running during internet outages, syncing automatically once you're back online." },
  { q: "What's the pricing?", a: "Transparent monthly pricing with no setup fee or lock-in. See our pricing page for plans, or talk to sales for chains and enterprise." },
];

const COMMON_MODULES = [
  m("POS Terminal", "/features/pos-terminal", "Lightning-fast billing with offline mode and split bills"),
  m("Inventory", "/features/inventory-management", "Real-time stock with recipe deduction and waste tracking"),
  m("Reports & Analytics", "/features/reports-analytics", "Live sales, item mix, channel and staff performance"),
  m("Khana AI", "/khana-ai", "AI menu, insights, forecasting and review booster"),
];

export const SOLUTION_CONTENT: Record<string, SolutionPageContent> = {
  "restaurants": {
    slug: "restaurants", industryLabel: "Restaurants",
    seoTitle: "Restaurant Management Software | KhanaLagao",
    seoDesc: "Complete restaurant management software for full-service venues. POS, KDS, tables, inventory, payroll, finance and AI — in one connected system.",
    hero: { eyebrow: "Full-Service Restaurants", title: "", tagline: "Elevate dine-in service with table-mapped POS, KOT routing, guest profiles and an operating system that respects the craft of hospitality.", mockup: "dashboard" },
    painPoints: { title: "What full-service restaurants struggle with", items: PROBLEM([
      { title: "Service breaks at peak hours", desc: "Legacy POS slows down, KOTs get lost, tables sit unattended." },
      { title: "Guest memory lives in heads", desc: "Allergies, preferences, regulars — known only to the server who's working tonight." },
      { title: "True margin is invisible", desc: "Food cost % is a month-end mystery, per-dish margin is a guess." },
    ])},
    modules: { title: "Built-in modules for full-service operations", items: [
      m("Table Management", "/features/table-management", "Floor plan, seat-level billing, course pacing, transfers"),
      m("Reservations", "/features/reservations", "Online bookings, deposits, SMS reminders, waitlist"),
      m("Kitchen Display", "/features/kitchen-display", "Station-aware routing, prep timers, course pacing"),
      m("Customer CRM", "/features/customer-crm", "Auto-captured profiles, preferences, lifetime value"),
      m("Recipe Management", "/features/recipe-management", "Standardize dishes and lock margin"),
      m("Growth Engine", "/features/growth-engine", "Campaigns, win-backs and birthday automations"),
      ...COMMON_MODULES,
    ]},
    workflow: { title: "A typical full-service day", steps: [
      { title: "Bookings & walk-ins", desc: "Reservations and waitlist managed from one host-stand view." },
      { title: "Seat & order", desc: "Server picks table from floor plan, takes order, items route to right station." },
      { title: "Course & serve", desc: "Auto course-pacing keeps mains landing after starters, every time." },
      { title: "Bill & retain", desc: "Bill by seat, settle in any method, capture guest for next visit." },
    ]},
    benefits: { title: "Real impact across service", items: [
      { title: "Higher table turn", desc: "Live floor plan + course pacing means more covers without rushing guests." },
      { title: "Better hospitality", desc: "Guest profiles surface at host stand — every regular feels remembered." },
      { title: "Stronger margins", desc: "Recipe costing, channel P&L and waste tracking defend your numbers." },
      { title: "Happier servers", desc: "Less running, fewer errors, more time for hospitality." },
    ]},
    scenario: { restaurantName: "Tandoor Vihaan, Bangalore (140 covers, multi-section)", quote: "We cut average ticket time by 28% and our regulars now get greeted by name. KhanaLagao is the first POS the floor team actually likes.", result: "+18% revenue, -28% ticket time in 90 days" },
    faqs: COMMON_FAQ("Restaurants"),
  },

  "cafes": {
    slug: "cafes", industryLabel: "Cafes & Coffee Shops",
    seoTitle: "Cafe Management Software | KhanaLagao",
    seoDesc: "Cafe POS and loyalty software for coffee shops. Fast order entry, modifiers, loyalty stamps, barista display and counter ops.",
    hero: { eyebrow: "Cafes & Coffee", title: "", tagline: "Keep the morning rush moving with one-tap modifiers, loyalty stamps, a barista display that never misses an order, and a stored-value wallet that turns one-timers into regulars.", mockup: "pos" },
    painPoints: { title: "What cafes struggle with", items: PROBLEM([
      { title: "Morning rush bottlenecks", desc: "Modifier-heavy orders (milk swaps, syrups, sizes) bog down legacy POS." },
      { title: "Loyalty doesn't move the needle", desc: "Punch cards lost; loyalty apps cost ₹15k/month and feel disconnected from POS." },
      { title: "Counter to barista friction", desc: "Orders shouted across the bar; modifiers lost in translation." },
    ])},
    modules: { title: "Cafe-specific modules", items: [
      m("POS Terminal", "/features/pos-terminal", "5-tap orders with saved modifier combos"),
      m("Combos & Add-ons", "/features/combos-addons", "Coffee + pastry combos, AI upsells"),
      m("Loyalty", "/features/loyalty", "Points, stamps, stored value — built in"),
      m("Wallet", "/features/wallet", "Top-ups with bonus, retention through balance"),
      m("Kitchen Display", "/features/kitchen-display", "Barista display with timers"),
      ...COMMON_MODULES,
    ]},
    workflow: { steps: [
      { title: "Morning rush", desc: "Pre-saved combos let baristas tap through 100 orders in an hour." },
      { title: "Modifier-aware KDS", desc: "Every modifier appears clearly on barista display — no shouting." },
      { title: "Loyalty earn & burn", desc: "Phone-number loyalty earns and burns at POS in one tap." },
      { title: "Day-end & restock", desc: "Auto reorder for milks and beans, day-end report on owner's phone." },
    ]},
    benefits: { title: "Faster service. Stickier regulars.", items: [
      { title: "Throughput up 30%+", desc: "Saved combos and modifier shortcuts double rush-hour capacity." },
      { title: "Regulars stick around", desc: "Phone-based loyalty and wallet drive serious repeat behavior." },
      { title: "Lower waste", desc: "Milk and pastry usage tracked, prep adjusted from real data." },
    ]},
    scenario: { restaurantName: "Brew & Bloom, Pune (3 outlets)", quote: "We replaced two apps and a punch-card system with KhanaLagao. Our wallet alone holds ₹6 lakhs at any time, and our morning rush throughput is up 40%.", result: "₹6 L wallet float, +40% rush throughput" },
    faqs: COMMON_FAQ("Cafes"),
  },

  "cloud-kitchens": {
    slug: "cloud-kitchens", industryLabel: "Cloud Kitchens",
    seoTitle: "Cloud Kitchen Software | KhanaLagao",
    seoDesc: "Cloud kitchen management software. Multi-brand POS, aggregator unification, rider dispatch, per-brand margin and shared inventory.",
    hero: { eyebrow: "Cloud Kitchens", title: "", tagline: "Run every aggregator from one screen, balance prep across brands, protect margin on every delivery rupee and own your direct-order customer relationship.", mockup: "kds" },
    painPoints: { title: "What cloud kitchens struggle with", items: PROBLEM([
      { title: "Aggregator chaos", desc: "5 tablets for 5 brands × 3 platforms = 15 screens nobody can manage." },
      { title: "Shared kitchen mayhem", desc: "Prep stations don't know which brand's order is firing next." },
      { title: "Per-brand margin invisible", desc: "Can't tell which brand or platform is actually profitable." },
    ])},
    modules: { title: "Multi-brand, multi-platform operations", items: [
      m("Orders", "/features/orders", "Unified inbox for all aggregators and direct"),
      m("Kitchen Display", "/features/kitchen-display", "Station-aware, brand-aware routing"),
      m("Delivery Management", "/features/delivery-management", "Your own rider operations"),
      m("Online Ordering", "/features/online-ordering", "Direct ordering without aggregator commissions"),
      m("Integrations", "/features/integrations", "Zomato, Swiggy, UberEats, logistics"),
      m("Settlements", "/features/settlements", "Recover every aggregator shortfall"),
      ...COMMON_MODULES,
    ]},
    workflow: { steps: [
      { title: "Order lands", desc: "From any platform, any brand — into one unified inbox." },
      { title: "Smart prep", desc: "Items split by station with brand and platform context." },
      { title: "Dispatch & track", desc: "Rider assigned, live tracking to customer door." },
      { title: "Per-brand P&L", desc: "Daily margin per brand, per platform, per hour." },
    ]},
    benefits: { title: "Run more brands. Earn more margin.", items: [
      { title: "Replace 15 tablets with 1 screen", desc: "Unified order inbox eliminates per-platform chaos." },
      { title: "Higher rider utilization", desc: "Multi-stop dispatch optimizes per-order delivery cost." },
      { title: "Real per-brand margin", desc: "Finally see which brand and platform are actually making money." },
    ]},
    scenario: { restaurantName: "FoodFusion Kitchens, Gurgaon (6 brands)", quote: "We were paying for 4 different tools and still missing settlement shortfalls. KhanaLagao unified everything and we recovered ₹2.4L in aggregator shortfalls in 60 days.", result: "₹2.4L recovered in 60 days, +12% margin" },
    faqs: COMMON_FAQ("Cloud Kitchens"),
  },

  "bakeries": {
    slug: "bakeries", industryLabel: "Bakeries & Patisseries",
    seoTitle: "Bakery Management Software | KhanaLagao",
    seoDesc: "Bakery management software. Pre-orders, wholesale, batch production planning, recipe costing and perishable inventory.",
    hero: { eyebrow: "Bakeries & Patisseries", title: "", tagline: "Manage pre-orders, wholesale customers and daily production batches without losing track of a single tray — with recipe-level costing for every bake.", mockup: "dashboard" },
    painPoints: { title: "What bakeries struggle with", items: PROBLEM([
      { title: "Pre-order chaos", desc: "Birthday cakes booked on WhatsApp with deposits forgotten." },
      { title: "Wholesale credit confusion", desc: "B2B customers with credit terms tracked in spreadsheets." },
      { title: "Batch waste", desc: "Daily production batches over- or under-produced due to gut feel." },
    ])},
    modules: { title: "Bakery-shaped modules", items: [
      m("Invoices", "/features/invoices", "B2B billing with credit terms and statements"),
      m("Recipe Management", "/features/recipe-management", "Sub-recipes for doughs, batters, fillings"),
      m("Inventory", "/features/inventory-management", "FEFO perishable rotation"),
      m("Online Ordering", "/features/online-ordering", "Pre-orders with deposits and pickup slots"),
      m("Customer CRM", "/features/customer-crm", "Birthday and anniversary remarketing"),
      ...COMMON_MODULES,
    ]},
    workflow: { steps: [
      { title: "Pre-orders captured", desc: "Cake customization, deposits, pickup slots tracked centrally." },
      { title: "Production planner", desc: "Auto-converts orders + forecasted retail into batch sheets." },
      { title: "Bake & sell", desc: "Counter sales deduct from real-time batch inventory." },
      { title: "Invoice & remarket", desc: "B2B invoices auto-generated; birthday remarketing fires." },
    ]},
    benefits: { title: "Less waste. More repeat orders.", items: [
      { title: "Lower batch waste", desc: "Production planner cuts over-baking dramatically." },
      { title: "Higher B2B AR", desc: "Branded invoices and auto-reminders shorten DSO." },
      { title: "More cake repeats", desc: "Birthday remarketing brings back occasion-driven customers." },
    ]},
    scenario: { restaurantName: "Maison de Pâtisserie, Mumbai", quote: "Our pre-order WhatsApp nightmare became a clean workflow. Wholesale invoicing dropped DSO from 45 days to 18.", result: "DSO 45 → 18 days, -22% waste" },
    faqs: COMMON_FAQ("Bakeries"),
  },

  "bars-pubs": {
    slug: "bars-pubs", industryLabel: "Bars & Pubs",
    seoTitle: "Bar & Pub POS Software | KhanaLagao",
    seoDesc: "Bar and pub POS software. Tab management, pour cost, happy hour automation, nightly cash-up and pour-cost analytics.",
    hero: { eyebrow: "Bars & Pubs", title: "", tagline: "Open tabs, transfer them between staff, settle by card or cash, and reconcile every bottle at close — without the spreadsheet.", mockup: "pos" },
    painPoints: { title: "What bars struggle with", items: PROBLEM([
      { title: "Tab and transfer chaos", desc: "Bartenders shouting drink names across the bar at handover." },
      { title: "Pour cost out of control", desc: "Nobody knows actual pour cost per bartender, per shift." },
      { title: "Cash-up disputes", desc: "Nightly drawer variance investigated only when it's big." },
    ])},
    modules: { title: "Bar-specific modules", items: [
      m("POS Terminal", "/features/pos-terminal", "Tab-based POS with transfers and holds"),
      m("Inventory", "/features/inventory-management", "Pour cost by recipe, brand, bartender"),
      m("Dynamic Pricing", "/features/dynamic-pricing", "Automated happy hour pricing"),
      m("Payments", "/features/payments", "Cash-up with variance flags"),
      m("Recipe Management", "/features/recipe-management", "Cocktail recipes with cost"),
      ...COMMON_MODULES,
    ]},
    workflow: { steps: [
      { title: "Open tabs", desc: "Tab by name, card-hold or table. Transfers between staff in one tap." },
      { title: "Pour & track", desc: "Every pour deducts inventory; pour cost calculated per ticket." },
      { title: "Happy hour", desc: "Dynamic pricing rules auto-apply during configured windows." },
      { title: "Nightly close", desc: "Cash-up with variance flags; pour cost vs sales reconciled." },
    ]},
    benefits: { title: "Tighter pour cost. Cleaner cash.", items: [
      { title: "Pour cost down 2-4 pts", desc: "Recipe-level pour cost and bartender accountability tighten margins." },
      { title: "Zero cash variance disputes", desc: "Nightly cash-up with audit trail eliminates blame games." },
      { title: "Higher tab AOV", desc: "Smart upsell prompts on POS lift drink and food attach." },
    ]},
    scenario: { restaurantName: "The Brewery, Bandra", quote: "We caught a ₹3-lakh-a-month pour cost leak in our first month. Cash variance dropped to under ₹500 a night.", result: "₹3L/mo pour cost recovered" },
    faqs: COMMON_FAQ("Bars & Pubs"),
  },

  "hotels": {
    slug: "hotels", industryLabel: "Hotels & Resorts",
    seoTitle: "Hotel F&B Management Software | KhanaLagao",
    seoDesc: "Hotel F&B management software. Room-charge posting, banquet billing, multi-outlet POS, department P&L and PMS integration.",
    hero: { eyebrow: "Hotels & Resorts", title: "", tagline: "F&B that talks to your PMS — room charges, banquet billing, and outlet-by-outlet performance, all in one place.", mockup: "dashboard" },
    painPoints: { title: "What hotel F&B teams struggle with", items: PROBLEM([
      { title: "PMS posting friction", desc: "Room charges manually posted from POS to PMS, with errors and lag." },
      { title: "Banquet billing complexity", desc: "BEOs, deposits, F&B + AV + service charges — managed in spreadsheets." },
      { title: "No per-outlet P&L", desc: "Restaurant, bar, banquet, room service — all blended in one F&B report." },
    ])},
    modules: { title: "Hotel-specific modules", items: [
      m("POS Terminal", "/features/pos-terminal", "Multi-outlet POS with room-charge posting"),
      m("Table Management", "/features/table-management", "Per-outlet floor plans"),
      m("Invoices", "/features/invoices", "Banquet proposals and invoices"),
      m("Reservations", "/features/reservations", "F&B bookings tied to room bookings"),
      m("Profit & Loss", "/features/profit-loss", "Per-outlet P&L and labor %"),
      m("Integrations", "/features/integrations", "PMS, accounting, gateway connectors"),
      ...COMMON_MODULES,
    ]},
    workflow: { steps: [
      { title: "Guest orders", desc: "At restaurant, bar, room service or banquet — one POS." },
      { title: "Room charge", desc: "Auto-post to PMS folio with audit trail." },
      { title: "Banquet event", desc: "BEO → deposit → F&B + AV invoice → settlement." },
      { title: "Department P&L", desc: "Per-outlet daily P&L, labor %, covers, average check." },
    ]},
    benefits: { title: "Cleaner F&B operations across every outlet", items: [
      { title: "Zero PMS posting errors", desc: "Auto-posting eliminates manual folio errors." },
      { title: "Banquet revenue captured", desc: "Formal BEO → invoice → settlement workflow captures every event detail." },
      { title: "Per-outlet visibility", desc: "Owners see which outlet drives margin and which bleeds." },
    ]},
    scenario: { restaurantName: "The Heritage Resort, Goa", quote: "Our banquet team finally has a real system. Per-outlet P&L showed us our coffee shop was losing ₹40k/month — we fixed it in 30 days.", result: "Coffee shop turned profitable in 30 days" },
    faqs: COMMON_FAQ("Hotels"),
  },

  "food-courts": {
    slug: "food-courts", industryLabel: "Food Courts",
    seoTitle: "Food Court Management Software | KhanaLagao",
    seoDesc: "Food court management software. Central kiosk ordering, multi-vendor routing, automated vendor settlement and shared loyalty.",
    hero: { eyebrow: "Food Courts", title: "", tagline: "One central kiosk, many kitchens. Split orders to the right counter and settle vendor commissions automatically.", mockup: "kds" },
    painPoints: { title: "What food courts struggle with", items: PROBLEM([
      { title: "Vendor routing nightmare", desc: "Central kiosk orders manually distributed to vendor kitchens." },
      { title: "Vendor settlement disputes", desc: "Weekly settlements done in Excel with constant disputes." },
      { title: "Wait time chaos", desc: "Guests have no idea where their food is across multiple vendors." },
    ])},
    modules: { title: "Food court modules", items: [
      m("Orders", "/features/orders", "Central kiosk with vendor routing"),
      m("Kitchen Display", "/features/kitchen-display", "Per-vendor KDS"),
      m("Payments", "/features/payments", "Unified payment with auto vendor settlement"),
      m("Loyalty", "/features/loyalty", "Shared loyalty across every vendor"),
      m("Reports & Analytics", "/features/reports-analytics", "Per-vendor performance"),
      ...COMMON_MODULES,
    ]},
    workflow: { steps: [
      { title: "Guest orders at kiosk", desc: "Self-service kiosk with vendor-aware menu." },
      { title: "Auto vendor routing", desc: "Items split to the right vendor's KDS with timing." },
      { title: "Ready board", desc: "Guest sees status on shared display; pickup point flagged." },
      { title: "Settle automatically", desc: "Per-vendor revenue tracked, commissions deducted, payouts auto." },
    ]},
    benefits: { title: "Smoother ops. Happier vendors.", items: [
      { title: "Zero settlement disputes", desc: "Every transaction tied to a vendor with audit trail." },
      { title: "Higher guest throughput", desc: "Self-order kiosks cut counter wait time dramatically." },
      { title: "Shared loyalty wallet", desc: "One loyalty program across every vendor drives repeat behavior." },
    ]},
    scenario: { restaurantName: "Phoenix Marketcity Food Court (24 vendors)", quote: "We replaced Excel-based settlement with KhanaLagao. Vendor disputes dropped to zero, guest throughput is up 35%.", result: "0 disputes, +35% throughput" },
    faqs: COMMON_FAQ("Food Courts"),
  },

  "tiffin-services": {
    slug: "tiffin-services", industryLabel: "Tiffin Services",
    seoTitle: "Tiffin Service Software | KhanaLagao",
    seoDesc: "Tiffin and meal subscription software. Daily subscriptions, route optimization, customer wallet and recurring billing.",
    hero: { eyebrow: "Tiffin Services", title: "", tagline: "Run daily subscriptions, optimize delivery routes, manage customer wallets and bill recurringly — without the WhatsApp chaos.", mockup: "mobile" },
    painPoints: { title: "What tiffin services struggle with", items: PROBLEM([
      { title: "Subscription management on WhatsApp", desc: "Daily skip/swap requests lost in chat backlogs." },
      { title: "Route inefficiency", desc: "Delivery routes built by hand, riders re-trace neighborhoods." },
      { title: "Wallet and recharge confusion", desc: "Customer balances tracked in registers, disputes weekly." },
    ])},
    modules: { title: "Tiffin-specific modules", items: [
      m("Memberships", "/features/memberships", "Monthly meal subscriptions"),
      m("Wallet", "/features/wallet", "Pre-paid customer wallets"),
      m("Delivery Management", "/features/delivery-management", "Route-optimized rider dispatch"),
      m("Online Ordering", "/features/online-ordering", "Subscriber self-service portal"),
      m("Menu Management", "/features/menu-management", "Daily / weekly menu cycles"),
      ...COMMON_MODULES,
    ]},
    workflow: { steps: [
      { title: "Subscribe", desc: "Customer subscribes on portal, sets preferences and route." },
      { title: "Daily ops", desc: "Skip/swap on app, route built automatically each morning." },
      { title: "Deliver & track", desc: "Rider routes optimized, customer tracks live ETA." },
      { title: "Recharge", desc: "Auto top-ups or monthly billing with reminders." },
    ]},
    benefits: { title: "Predictable revenue. Better delivery economics.", items: [
      { title: "Recurring MRR", desc: "Subscriptions create predictable monthly revenue." },
      { title: "Better delivery routes", desc: "Auto-optimized routes cut per-delivery cost." },
      { title: "Less customer support", desc: "Self-service skip/swap and wallet reduce WhatsApp churn." },
    ]},
    scenario: { restaurantName: "Annapurna Tiffins, Hyderabad (1,200 subscribers)", quote: "Our skip-swap WhatsApp group used to have 200 messages a day. Now it has 5. Riders save 40 minutes a day per route.", result: "200 → 5 WhatsApp/day, +40 min/rider saved" },
    faqs: COMMON_FAQ("Tiffin Services"),
  },

  "catering-banquets": {
    slug: "catering-banquets", industryLabel: "Catering & Banquets",
    seoTitle: "Catering Management Software | KhanaLagao",
    seoDesc: "Catering and banquet management software. Quotations, BEOs, deposits, F&B invoicing, kitchen production planning and event tracking.",
    hero: { eyebrow: "Catering & Banquets", title: "", tagline: "From quotation to event execution — proposals, BEOs, deposits, F&B invoices, kitchen production and post-event settlement.", mockup: "report" },
    painPoints: { title: "What catering operations struggle with", items: PROBLEM([
      { title: "Quote-to-cash on email + Excel", desc: "Proposals, deposits, invoices, payments — all scattered across email threads." },
      { title: "Kitchen production guesswork", desc: "Production for big events done from memory, often over or under." },
      { title: "Post-event settlement chaos", desc: "AV, service, F&B, breakage — settled days late with errors." },
    ])},
    modules: { title: "Catering-specific modules", items: [
      m("Invoices", "/features/invoices", "Catering proposals → invoices → settlement"),
      m("Recipe Management", "/features/recipe-management", "Scale recipes for any party size"),
      m("Inventory", "/features/inventory-management", "Event-based stock reservations"),
      m("Staff Tasks", "/features/staff-tasks", "Event execution checklists"),
      m("Customer CRM", "/features/customer-crm", "Client history and preferences"),
      ...COMMON_MODULES,
    ]},
    workflow: { steps: [
      { title: "Quote", desc: "Branded proposal with line-item F&B, AV, service charges." },
      { title: "Confirm + deposit", desc: "Client confirms, deposit collected, calendar locked." },
      { title: "Execute", desc: "Production planner, stock reserved, staff checklist." },
      { title: "Settle", desc: "Final invoice with adjustments, deposit netted, payment collected." },
    ]},
    benefits: { title: "Predictable execution. Cleaner books.", items: [
      { title: "Faster quote-to-cash", desc: "End email threads — one workflow from proposal to settlement." },
      { title: "Production accuracy", desc: "Scale recipes to exact cover count; cut over-production." },
      { title: "Repeat catering clients", desc: "CRM tracks event history for upsell and re-bookings." },
    ]},
    scenario: { restaurantName: "Grand Catering Co., Delhi", quote: "Quote-to-cash collapsed from 14 days to 3. Production waste on our 500-cover events dropped 30%.", result: "Quote-to-cash 14 → 3 days" },
    faqs: COMMON_FAQ("Catering & Banquets"),
  },

  "franchise-chains": {
    slug: "franchise-chains", industryLabel: "Franchise Chains",
    seoTitle: "Restaurant Franchise Software | KhanaLagao",
    seoDesc: "Restaurant franchise management software. Master menu with outlet overrides, central reporting, brand standards audits and royalty calculations.",
    hero: { eyebrow: "Franchise & Multi-Outlet", title: "", tagline: "Centralize the brand. Empower each outlet. Audit standards. Calculate royalties. Roll out a new combo to 50 outlets in 60 seconds.", mockup: "dashboard" },
    painPoints: { title: "What franchise operators struggle with", items: PROBLEM([
      { title: "Brand drift", desc: "Each franchisee runs the brand slightly differently — and dilutes it." },
      { title: "Royalty disputes", desc: "Royalty calculations based on franchisee-reported revenue, with disputes." },
      { title: "Slow rollouts", desc: "New combos and menu changes take weeks to land at every outlet." },
    ])},
    modules: { title: "Franchise-specific modules", items: [
      m("Super Admin", "/features/super-admin", "Multi-tenant control plane"),
      m("Menu Management", "/features/menu-management", "Master menu with outlet overrides"),
      m("Reports & Analytics", "/features/reports-analytics", "Consolidated multi-outlet reporting"),
      m("Mystery Audits", "/features/mystery-audits", "Brand-standard audit workflows"),
      m("Stock Transfers", "/features/stock-transfers", "Inter-outlet ingredient movement"),
      m("Profit & Loss", "/features/profit-loss", "Per-outlet daily P&L"),
      ...COMMON_MODULES,
    ]},
    workflow: { steps: [
      { title: "Set brand standards", desc: "Master menu, recipes, SOPs, audit framework defined centrally." },
      { title: "Outlets operate", desc: "Each outlet runs day-to-day with local pricing/availability overrides." },
      { title: "Royalty auto-calc", desc: "Revenue captured at source; royalties auto-calculated and invoiced." },
      { title: "Audit & rollout", desc: "Mystery audits enforce standards; new launches push to all outlets instantly." },
    ]},
    benefits: { title: "Scale the brand. Defend the standards.", items: [
      { title: "Zero royalty disputes", desc: "Revenue captured at source means royalties are objectively correct." },
      { title: "Faster rollouts", desc: "Menu and combo launches reach every outlet in seconds." },
      { title: "Brand consistency", desc: "Audit framework + SOP training enforces brand standards." },
    ]},
    scenario: { restaurantName: "Anand Sweets, 24 outlets (Karnataka + TN)", quote: "Royalty disputes gone. New product launches that used to take 3 weeks now happen in a morning.", result: "0 royalty disputes, 3wk → 1 day launches" },
    faqs: COMMON_FAQ("Franchise Chains"),
  },

  "corporate-canteens": {
    slug: "corporate-canteens", industryLabel: "Corporate Canteens",
    seoTitle: "Corporate Canteen Management Software | KhanaLagao",
    seoDesc: "Corporate canteen management software. Employee meal subscriptions, wallet-based ordering, attendance integration and meal reports.",
    hero: { eyebrow: "Corporate Canteens", title: "", tagline: "Run employee canteens with wallet-based ordering, meal subscriptions, dietary preferences and consolidated invoicing to HR.", mockup: "mobile" },
    painPoints: { title: "What corporate canteens struggle with", items: PROBLEM([
      { title: "Wallet recharge friction", desc: "Employees lose meal tokens, can't recharge easily." },
      { title: "Menu rotation", desc: "Daily / weekly menus communicated via posters, not consumed digitally." },
      { title: "Invoicing to HR", desc: "Monthly consolidated invoicing done in spreadsheets with errors." },
    ])},
    modules: { title: "Canteen-specific modules", items: [
      m("Wallet", "/features/wallet", "Employee meal wallets with auto top-up"),
      m("Memberships", "/features/memberships", "Meal subscription plans"),
      m("Online Ordering", "/features/online-ordering", "App-based pre-order and pickup"),
      m("Invoices", "/features/invoices", "Consolidated B2B invoicing to corporate HR"),
      m("Menu Management", "/features/menu-management", "Daily rotating menu"),
      ...COMMON_MODULES,
    ]},
    workflow: { steps: [
      { title: "Employee orders", desc: "App-based pre-order or counter QR scan." },
      { title: "Wallet deduction", desc: "Wallet auto-deducts; HR-funded or employee-funded." },
      { title: "Pick-up or delivery", desc: "Counter pickup or desk delivery with status updates." },
      { title: "Monthly invoice", desc: "Consolidated invoice to HR with per-employee detail." },
    ]},
    benefits: { title: "Predictable canteen ops", items: [
      { title: "Higher employee satisfaction", desc: "Pre-order, pickup, dietary filters reduce lunch wait." },
      { title: "Cleaner HR invoicing", desc: "Auto-consolidated invoicing with audit trail." },
      { title: "Lower food waste", desc: "Pre-orders enable accurate production planning." },
    ]},
    scenario: { restaurantName: "Sodexo @ Infosys Bangalore", quote: "We replaced our meal-token system with KhanaLagao wallet. Lunch wait time dropped from 22 minutes to 6.", result: "Lunch wait 22 → 6 min" },
    faqs: COMMON_FAQ("Corporate Canteens"),
  },

  "school-college-canteens": {
    slug: "school-college-canteens", industryLabel: "School & College Canteens",
    seoTitle: "School Canteen Management Software | KhanaLagao",
    seoDesc: "School and college canteen management software. Student wallets, parent recharge, dietary filters, allergen tracking and meal reports.",
    hero: { eyebrow: "School & College", title: "", tagline: "Cashless canteens with student wallets, parent recharge, dietary filters and allergen alerts — built for campus food services.", mockup: "mobile" },
    painPoints: { title: "What campus canteens struggle with", items: PROBLEM([
      { title: "Cash and small change", desc: "Cash management with hundreds of students is a daily headache." },
      { title: "Allergen management", desc: "No way to track or alert on student allergens at the counter." },
      { title: "Parent visibility", desc: "Parents don't know what their kids eat or how much they spend." },
    ])},
    modules: { title: "Campus-specific modules", items: [
      m("Wallet", "/features/wallet", "Student wallets with parent recharge"),
      m("Customer CRM", "/features/customer-crm", "Student profiles with allergens"),
      m("Online Ordering", "/features/online-ordering", "Pre-order from classrooms"),
      m("Menu Management", "/features/menu-management", "Allergen + nutritional info per item"),
      m("Reports & Analytics", "/features/reports-analytics", "Spending and consumption reports"),
      ...COMMON_MODULES,
    ]},
    workflow: { steps: [
      { title: "Parent recharges", desc: "Wallet recharged via app with auto top-up options." },
      { title: "Student orders", desc: "QR scan at canteen or pre-order from classroom." },
      { title: "Allergen alerts", desc: "Counter warns if student profile flags an allergen." },
      { title: "Parent gets reports", desc: "Monthly spend + nutrition reports to parent." },
    ]},
    benefits: { title: "Safer, faster, more transparent canteens", items: [
      { title: "Zero cash management", desc: "Cashless wallets eliminate small-change headaches." },
      { title: "Allergen safety", desc: "Profile-based alerts prevent dangerous mistakes." },
      { title: "Parent confidence", desc: "Visibility into what kids eat and spend." },
    ]},
    scenario: { restaurantName: "DPS RK Puram Canteen, Delhi", quote: "Allergen alerts at the counter saved a kid with a peanut allergy in our first month. Parents love the spending visibility.", result: "Zero cash, zero allergen incidents in 6 months" },
    faqs: COMMON_FAQ("School & College Canteens"),
  },
};
