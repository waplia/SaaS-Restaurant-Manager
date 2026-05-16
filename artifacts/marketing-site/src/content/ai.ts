import {
  Camera, Image as ImageIcon, FileText, Star, Megaphone, LineChart,
  TrendingUp, Bot, Coins, Sparkles, Brain, MessageSquare, Zap, Clock,
  ShieldCheck, Activity, BarChart3, Globe, Layers, ChefHat,
} from "lucide-react";
import type { AIPageContent } from "@/components/templates/AIPage";

const COMMON_FAQS = (name: string) => [
  { q: `What model powers ${name}?`, a: `KhanaLagao plugs into best-in-class LLMs (Anthropic Claude, OpenAI GPT, Google Gemini) — and you can choose which model your tenant uses. We meter usage in AI credits, regardless of model.` },
  { q: "Where does my data go?", a: "Your data stays in your tenant. Prompts are processed by the model provider but never used for training. SOC 2 and GDPR-ready data handling." },
  { q: "How are AI credits priced?", a: "Each AI action consumes credits. Credits are bundled with paid plans and can be topped up. See the AI credits page for current pricing." },
  { q: "Can I disable AI features?", a: "Yes — every AI feature is feature-flagged and can be turned off per tenant or per outlet from Super Admin." },
];

export const AI_CONTENT: Record<string, AIPageContent> = {
  "menu-import": {
    slug: "menu-import", shortName: "AI Menu Import",
    title: "Turn a photo into a digital menu in 60 seconds",
    tagline: "Photograph your menu — printed, handwritten, even chalkboard — and Khana AI extracts categories, items, modifiers, prices and descriptions ready to go live.",
    features: [
      { title: "Photo, PDF or chalkboard", desc: "Upload from any format — even handwritten menus and chalkboards.", icon: Camera },
      { title: "Auto-extracts everything", desc: "Categories, items, prices, modifiers, descriptions — structured.", icon: Layers },
      { title: "Multi-language support", desc: "Reads Hindi, English, regional scripts; structures bilingually.", icon: Globe },
      { title: "Edit and confirm", desc: "Quick review screen lets you fix anything before publishing.", icon: FileText },
      { title: "Publishes everywhere", desc: "Live on QR menu, POS, online ordering and aggregators instantly.", icon: Zap },
      { title: "Suggestions included", desc: "AI flags missing descriptions, suggests combos, recommends pricing.", icon: Sparkles },
    ],
    steps: [
      { title: "Snap or upload", desc: "Photo your menu or upload PDF / image." },
      { title: "AI extracts", desc: "Categories, items, modifiers, prices auto-extracted." },
      { title: "Review & publish", desc: "Quick edit, then publishes to every channel." },
    ],
    benefits: [
      { title: "Hours saved on onboarding", desc: "Menu setup that used to take a day done in minutes." },
      { title: "Zero data-entry errors", desc: "AI extraction is more accurate than manual entry." },
      { title: "Faster brand launches", desc: "New cloud kitchen brands live the same afternoon." },
    ],
    mockup: "chat",
    faqs: COMMON_FAQS("AI Menu Import"),
  },

  "descriptions": {
    slug: "descriptions", shortName: "AI Descriptions",
    title: "AI dish descriptions that make guests order",
    tagline: "One-tap mouth-watering descriptions for every menu item — in your brand voice, multiple languages, with allergens flagged.",
    features: [
      { title: "Brand-voice tuned", desc: "Train on your tone — premium, fun, casual, traditional.", icon: Sparkles },
      { title: "Multi-language", desc: "Generate in Hindi, English, regional languages simultaneously.", icon: Globe },
      { title: "Allergen-aware", desc: "Auto-flags common allergens in descriptions.", icon: ShieldCheck },
      { title: "Length-controlled", desc: "Short for menus, long for product pages — same source.", icon: FileText },
      { title: "Bulk generation", desc: "Regenerate every description on your menu in one batch.", icon: Zap },
      { title: "A/B testing", desc: "Test two descriptions, let conversion data pick the winner.", icon: Activity },
    ],
    steps: [
      { title: "Pick items", desc: "Select items or run on entire menu." },
      { title: "Set voice & length", desc: "Brand voice, language, target length." },
      { title: "Review & publish", desc: "Edit before publishing across channels." },
    ],
    benefits: [
      { title: "Higher click-to-add rate", desc: "Mouth-watering descriptions lift conversion on QR menu and online." },
      { title: "Consistent brand voice", desc: "Every dish sounds like your brand, not a template." },
      { title: "Faster menu launches", desc: "Drop descriptions in minutes, not hours." },
    ],
    faqs: COMMON_FAQS("AI Descriptions"),
  },

  "food-images": {
    slug: "food-images", shortName: "AI Food Images",
    title: "Studio-quality food images, on demand",
    tagline: "Generate beautiful, on-brand dish photography from a text prompt or a low-quality phone shot — for menus, social media and ads.",
    features: [
      { title: "Photo studio output", desc: "Studio-quality plating, lighting and backgrounds.", icon: Camera },
      { title: "Brand-consistent", desc: "Train on your existing photography for visual consistency.", icon: Sparkles },
      { title: "From text or photo", desc: "Generate from a description or enhance a quick phone shot.", icon: ImageIcon },
      { title: "Channel-ready", desc: "Auto-crop for QR menu, Instagram, Zomato, signage.", icon: Layers },
      { title: "Bulk generation", desc: "Generate images for every item on your menu in one go.", icon: Zap },
      { title: "On-prem upload", desc: "Replace existing low-quality images across every channel.", icon: Globe },
    ],
    steps: [
      { title: "Describe or upload", desc: "Text prompt or low-quality photo as input." },
      { title: "AI generates", desc: "Studio-quality output in seconds." },
      { title: "Publish across channels", desc: "Auto-cropped and pushed to every menu surface." },
    ],
    benefits: [
      { title: "Higher menu engagement", desc: "Beautiful imagery lifts click-to-add rate significantly." },
      { title: "Studio cost saved", desc: "Replace recurring food photography spend." },
      { title: "Faster new launches", desc: "New dishes go live with hero imagery the same day." },
    ],
    faqs: COMMON_FAQS("AI Food Images"),
  },

  "review-booster": {
    slug: "review-booster", shortName: "AI Review Booster",
    title: "AI-drafted Google reviews your guests actually post",
    tagline: "After a great meal, Khana AI drafts a personalized review based on what the guest ordered. They copy, one-tap to Google, your rating climbs.",
    features: [
      { title: "Personalized drafts", desc: "Uses ordered items, time of visit and rating to draft a unique review.", icon: Brain },
      { title: "One-tap copy & post", desc: "Copy text, one-tap Google review page link.", icon: Star },
      { title: "Multi-language", desc: "Drafts in Hindi, English, regional languages.", icon: Globe },
      { title: "Smart routing", desc: "Happy guests routed to Google; unhappy to manager.", icon: ShieldCheck },
      { title: "No Google API needed", desc: "Works without any Google Business API integration.", icon: Zap },
      { title: "Review analytics", desc: "Track velocity, rating distribution and theme trends.", icon: BarChart3 },
    ],
    steps: [
      { title: "Guest pays", desc: "QR menu shows quick rating screen." },
      { title: "AI drafts review", desc: "Personalized review using order context." },
      { title: "Guest copies & posts", desc: "One tap opens Google review page." },
    ],
    benefits: [
      { title: "3-5× more reviews", desc: "Operators consistently see 3-5× lift in Google review volume." },
      { title: "Higher rating", desc: "Negative routed to manager, positive amplified to Google." },
      { title: "Better local SEO", desc: "Review velocity drives Maps visibility." },
    ],
    faqs: COMMON_FAQS("AI Review Booster"),
  },

  "campaigns": {
    slug: "campaigns", shortName: "AI Campaigns",
    title: "Marketing campaigns Khana AI runs for you",
    tagline: "Pick a goal — bring back lapsed guests, fill Tuesday lunch, push the new dessert. AI builds the campaign: copy, segment, channel, send-time.",
    features: [
      { title: "Goal-driven", desc: "Pick objective, AI designs the campaign end-to-end.", icon: Brain },
      { title: "Smart segments", desc: "AI builds the right segment for the goal automatically.", icon: Layers },
      { title: "AI copywriting", desc: "Drafts SMS, WhatsApp and email copy in your brand voice.", icon: MessageSquare },
      { title: "Optimal send-time", desc: "AI picks the right time per guest based on engagement.", icon: Clock },
      { title: "Channel selection", desc: "AI picks the right channel per guest preference.", icon: Megaphone },
      { title: "Attribution & learning", desc: "AI learns from campaign performance, gets smarter.", icon: TrendingUp },
    ],
    steps: [
      { title: "Pick goal", desc: "Win back lapsed, fill off-peak, push new item, etc." },
      { title: "AI designs", desc: "Audience, copy, channel, timing — all AI-generated." },
      { title: "Approve & send", desc: "Review draft, approve, AI sends and measures." },
    ],
    benefits: [
      { title: "Higher ROI", desc: "AI-driven campaigns outperform manual blasts by 3-5×." },
      { title: "No marketing team needed", desc: "AI handles the entire campaign lifecycle." },
      { title: "Always-on", desc: "AI runs campaigns continuously, learning and improving." },
    ],
    faqs: COMMON_FAQS("AI Campaigns"),
  },

  "sales-insights": {
    slug: "sales-insights", shortName: "AI Sales Insights",
    title: "Daily AI insights you'd hire an analyst for",
    tagline: "Every morning, Khana AI delivers a brief: what sold, what stalled, what to push tonight, which guests to win back. Like an analyst, on every shift.",
    features: [
      { title: "Daily morning brief", desc: "What sold, what stalled, what to act on — on your phone before opening." },
      { title: "Anomaly detection", desc: "AI flags unusual drops, spikes, margin shifts." , icon: Activity },
      { title: "Recommendation engine", desc: "Specific actions: push this item, run this combo, message these guests." , icon: Sparkles },
      { title: "Drilldown to detail", desc: "Tap any insight to drill into transactional detail." , icon: BarChart3 },
      { title: "Comparative analysis", desc: "Vs last week, vs last month, vs sister outlets." , icon: LineChart },
      { title: "Scheduled briefs", desc: "Daily, weekly, monthly — delivered by SMS, WhatsApp, email." , icon: Clock },
    ].map(f => ({ ...f, icon: f.icon ?? Brain })),
    steps: [
      { title: "Data flows in", desc: "Sales, orders, customers, inventory continuously ingested." },
      { title: "AI analyzes", desc: "Anomaly detection, trends, recommendations generated." },
      { title: "Brief delivered", desc: "Daily brief on phone every morning before service." },
    ],
    benefits: [
      { title: "Operator-level insights", desc: "Daily insights at the level of a full-time analyst." },
      { title: "Faster decisions", desc: "Owners and GMs act on data in hours, not weeks." },
      { title: "Compounding gains", desc: "Small daily insights add up to material margin improvement." },
    ],
    mockup: "report",
    faqs: COMMON_FAQS("AI Sales Insights"),
  },

  "forecasting": {
    slug: "forecasting", shortName: "AI Forecasting",
    title: "Forecast demand, prep, staffing and stock with AI",
    tagline: "Khana AI forecasts tomorrow's covers, prep quantities, ingredient needs and required staffing — based on history, weather, events and trends.",
    features: [
      { title: "Cover forecasting", desc: "Hourly cover counts per outlet per day.", icon: TrendingUp },
      { title: "Prep planning", desc: "Recommended prep quantities per item per shift.", icon: ChefHat },
      { title: "Staffing recommendations", desc: "Optimal shift staffing for forecasted demand.", icon: Activity },
      { title: "Inventory needs", desc: "Forecasted ingredient consumption for next 7 days.", icon: Layers },
      { title: "External signals", desc: "Weather, holidays, events, local trends factored in.", icon: Globe },
      { title: "Variance tracking", desc: "Compare forecast to actual; AI learns and improves.", icon: BarChart3 },
    ],
    steps: [
      { title: "AI learns", desc: "Trained on your historical sales and external signals." },
      { title: "Forecast generated", desc: "Daily forecasts pushed to operators." },
      { title: "Plan & execute", desc: "Prep, staff and procurement aligned to forecast." },
    ],
    benefits: [
      { title: "Lower food waste", desc: "Prep matched to demand cuts over-production." },
      { title: "Lower labor cost", desc: "Staff scheduled to demand, not gut feel." },
      { title: "Higher service quality", desc: "Right ingredients, right staff, right time." },
    ],
    mockup: "report",
    faqs: COMMON_FAQS("AI Forecasting"),
  },

  "chat-assistant": {
    slug: "chat-assistant", shortName: "AI Chat Assistant",
    title: "Ask your data anything",
    tagline: "Chat with your restaurant. 'What sold best Friday night last week?' 'Which guests haven't visited in 60 days?' 'Suggest a Tuesday lunch combo.' Khana AI answers.",
    features: [
      { title: "Natural language", desc: "Ask in English or Hindi — get answers from your data.", icon: MessageSquare },
      { title: "Operational queries", desc: "Sales, inventory, customers, staff, finance — any question.", icon: Brain },
      { title: "Actionable suggestions", desc: "AI suggests campaigns, combos, pricing moves with data backing.", icon: Sparkles },
      { title: "Multi-outlet aware", desc: "Asks scope: this outlet, all outlets, specific brand.", icon: Layers },
      { title: "Action triggers", desc: "Ask AI to draft a campaign or fire a coupon — confirm and ship.", icon: Zap },
      { title: "Audit trail", desc: "Every action triggered by AI logged for review.", icon: ShieldCheck },
    ],
    steps: [
      { title: "Ask anything", desc: "Natural-language query from any device." },
      { title: "AI answers", desc: "Pulls from your data, returns structured answer with charts." },
      { title: "Act on it", desc: "Approve AI-suggested actions and ship them live." },
    ],
    benefits: [
      { title: "Instant answers", desc: "No more digging through reports for one number." },
      { title: "Democratize data", desc: "Every GM and chef can ask their own questions." },
      { title: "Compound learning", desc: "AI gets smarter on your specific data over time." },
    ],
    mockup: "chat",
    faqs: COMMON_FAQS("AI Chat Assistant"),
  },

  "credits": {
    slug: "credits", shortName: "AI Credits",
    title: "AI credits — pay only for what you use",
    tagline: "All AI features are metered in AI credits. Bundled with paid plans, top up any time, choose your model. Transparent. Predictable. Fair.",
    features: [
      { title: "Bundled with plans", desc: "Generous monthly credit allowance with every paid plan.", icon: Coins },
      { title: "Top up any time", desc: "Buy additional credits in packs; no expiry.", icon: Zap },
      { title: "Per-feature metering", desc: "See credit consumption per feature, per outlet, per day.", icon: Activity },
      { title: "Model selection", desc: "Choose Claude, GPT, Gemini per feature for cost/quality balance.", icon: Brain },
      { title: "Budget controls", desc: "Set per-outlet credit caps to prevent runaway usage.", icon: ShieldCheck },
      { title: "Volume discounts", desc: "Larger credit packs at lower per-credit cost.", icon: TrendingUp },
    ],
    steps: [
      { title: "Plan includes credits", desc: "Every paid plan ships with monthly AI credits." },
      { title: "Use across features", desc: "Spend on menu import, descriptions, campaigns, chat, etc." },
      { title: "Top up as needed", desc: "Pay-as-you-go top-ups for growth months." },
    ],
    benefits: [
      { title: "Predictable AI spend", desc: "Know exactly what AI is costing you, per feature." },
      { title: "Fair pricing", desc: "Pay only for AI actions actually used." },
      { title: "Model flexibility", desc: "Pick the right model for the right job and cost." },
    ],
    faqs: COMMON_FAQS("AI Credits"),
  },
};
