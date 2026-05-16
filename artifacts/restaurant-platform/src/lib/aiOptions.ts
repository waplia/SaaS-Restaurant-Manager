export const AI_TONES: Array<{ value: string; label: string }> = [
  { value: "simple", label: "Simple & friendly" },
  { value: "premium", label: "Premium / fine-dining" },
  { value: "playful", label: "Playful" },
  { value: "traditional", label: "Traditional" },
  { value: "bold", label: "Bold & spicy" },
  { value: "casual", label: "Casual" },
  { value: "formal", label: "Formal" },
  { value: "witty", label: "Witty" },
  { value: "descriptive", label: "Descriptive" },
  { value: "minimal", label: "Minimal" },
  { value: "storyteller", label: "Storyteller" },
  { value: "rustic", label: "Rustic / homemade" },
];

export const AI_LANGUAGES: Array<{ value: string; label: string }> = [
  { value: "en", label: "English" },
  { value: "hi", label: "Hindi (हिंदी)" },
  { value: "hinglish", label: "Hinglish" },
  { value: "ta", label: "Tamil (தமிழ்)" },
  { value: "bn", label: "Bengali (বাংলা)" },
  { value: "te", label: "Telugu (తెలుగు)" },
  { value: "mr", label: "Marathi (मराठी)" },
  { value: "gu", label: "Gujarati (ગુજરાતી)" },
  { value: "pa", label: "Punjabi (ਪੰਜਾਬੀ)" },
  { value: "kn", label: "Kannada (ಕನ್ನಡ)" },
  { value: "ml", label: "Malayalam (മലയാളം)" },
  { value: "or", label: "Odia (ଓଡ଼ିଆ)" },
  { value: "ur", label: "Urdu (اردو)" },
  { value: "ar", label: "Arabic (العربية)" },
  { value: "fr", label: "French" },
  { value: "es", label: "Spanish" },
  { value: "de", label: "German" },
  { value: "zh", label: "Chinese (Simplified)" },
];

export const AI_LENGTHS: Array<{ value: string; label: string }> = [
  { value: "short", label: "Short" },
  { value: "long", label: "Long" },
  { value: "premium", label: "Premium" },
];

export const AI_DESCRIPTION_VARIANTS: Array<{ value: string; label: string; help: string }> = [
  { value: "short", label: "Short blurb", help: "1–2 sentences for compact listings." },
  { value: "premium", label: "Premium copy", help: "Evocative copy for fine-dining presentation." },
  { value: "qr_menu", label: "QR menu", help: "Punchy phrasing optimised for table QR menus." },
  { value: "online_ordering", label: "Online ordering", help: "Conversion-focused copy for delivery & pickup." },
  { value: "allergen_focused", label: "Allergen-focused", help: "Emphasises common allergens up front." },
  { value: "ingredient_focused", label: "Ingredient-focused", help: "Highlights key ingredients and cooking method." },
  { value: "upsell", label: "Upsell add-on", help: "Encourages add-ons, sides, or premium swaps." },
];

export type AiDescriptionVariant = (typeof AI_DESCRIPTION_VARIANTS)[number]["value"];
