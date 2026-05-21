/**
 * Curated default catalog of Indian dishes for the stock food image
 * library. Image URLs point at Wikimedia Commons (royalty-free,
 * hot-linkable). Super-admins can edit, deactivate, or extend this
 * catalog from the admin UI — the seeder only adds missing slugs,
 * it never overwrites existing rows.
 *
 * Adding a new dish here will register it on the next API boot.
 */

export interface StockFoodSeedEntry {
  /** Optional explicit slug; defaults to slugified name. */
  slug?: string;
  name: string;
  cuisine?: string;
  category?: string;
  imageUrl: string;
  thumbnailUrl?: string;
  aliases?: string[];
  tags?: string[];
  isVeg?: boolean;
  sortOrder?: number;
  attribution?: string;
}

const W = "https://upload.wikimedia.org/wikipedia/commons";

export const STOCK_FOOD_IMAGE_SEED: StockFoodSeedEntry[] = [
  // ─── North Indian — Veg curries ────────────────────────────────
  {
    name: "Paneer Tikka",
    cuisine: "north-indian", category: "starter", isVeg: true,
    imageUrl: `${W}/thumb/3/30/Paneer_Tikka_at_Velleeswarar_Sannathi_Restaurant%2C_Chennai.jpg/800px-Paneer_Tikka_at_Velleeswarar_Sannathi_Restaurant%2C_Chennai.jpg`,
    aliases: ["tandoori paneer", "paneer tikka kabab"],
    tags: ["tandoori", "starter", "popular"],
    attribution: "Wikimedia Commons",
  },
  {
    name: "Palak Paneer",
    cuisine: "north-indian", category: "curry", isVeg: true,
    imageUrl: `${W}/thumb/c/c2/Palak_Paneer_with_naan.jpg/800px-Palak_Paneer_with_naan.jpg`,
    aliases: ["saag paneer", "spinach paneer"],
    tags: ["curry", "spinach"],
    attribution: "Wikimedia Commons",
  },
  {
    name: "Paneer Butter Masala",
    cuisine: "north-indian", category: "curry", isVeg: true,
    imageUrl: `${W}/thumb/f/f0/Paneer_makhani.JPG/800px-Paneer_makhani.JPG`,
    aliases: ["paneer makhani", "butter paneer"],
    tags: ["curry", "creamy", "popular"],
    attribution: "Wikimedia Commons",
  },
  {
    name: "Dal Makhani",
    cuisine: "north-indian", category: "dal", isVeg: true,
    imageUrl: `${W}/thumb/c/c3/Dal_makhani.JPG/800px-Dal_makhani.JPG`,
    aliases: ["maa ki dal", "black dal"],
    tags: ["dal", "creamy", "popular"],
    attribution: "Wikimedia Commons",
  },
  {
    name: "Dal Tadka",
    cuisine: "north-indian", category: "dal", isVeg: true,
    imageUrl: `${W}/thumb/8/89/Dal_Tadka.jpg/800px-Dal_Tadka.jpg`,
    aliases: ["yellow dal", "dal fry"],
    tags: ["dal"],
    attribution: "Wikimedia Commons",
  },
  {
    name: "Chana Masala",
    cuisine: "north-indian", category: "curry", isVeg: true,
    imageUrl: `${W}/thumb/8/8c/Chole_or_chana_masala.jpg/800px-Chole_or_chana_masala.jpg`,
    aliases: ["chole", "chickpea curry", "chole masala"],
    tags: ["curry", "chickpea"],
    attribution: "Wikimedia Commons",
  },
  {
    name: "Rajma",
    cuisine: "north-indian", category: "curry", isVeg: true,
    imageUrl: `${W}/thumb/0/07/Rajma_Chawal.jpg/800px-Rajma_Chawal.jpg`,
    aliases: ["rajma chawal", "kidney bean curry"],
    tags: ["curry", "comfort"],
    attribution: "Wikimedia Commons",
  },
  {
    name: "Aloo Gobi",
    cuisine: "north-indian", category: "curry", isVeg: true,
    imageUrl: `${W}/thumb/b/b1/Aloo_gobi.jpg/800px-Aloo_gobi.jpg`,
    aliases: ["potato cauliflower"],
    tags: ["dry-curry"],
    attribution: "Wikimedia Commons",
  },
  {
    name: "Malai Kofta",
    cuisine: "north-indian", category: "curry", isVeg: true,
    imageUrl: `${W}/thumb/6/6a/Malai_kofta.jpg/800px-Malai_kofta.jpg`,
    tags: ["curry", "creamy"],
    attribution: "Wikimedia Commons",
  },
  {
    name: "Baingan Bharta",
    cuisine: "north-indian", category: "curry", isVeg: true,
    imageUrl: `${W}/thumb/4/4a/Baingan_Bharta.JPG/800px-Baingan_Bharta.JPG`,
    aliases: ["smoked eggplant"],
    tags: ["smoky"],
    attribution: "Wikimedia Commons",
  },

  // ─── Breads ───────────────────────────────────────────────────
  {
    name: "Butter Naan",
    cuisine: "north-indian", category: "bread", isVeg: true,
    imageUrl: `${W}/thumb/7/73/Naan_Indian_bread.jpg/800px-Naan_Indian_bread.jpg`,
    aliases: ["naan", "plain naan"],
    tags: ["bread", "tandoor"],
    attribution: "Wikimedia Commons",
  },
  {
    name: "Garlic Naan",
    cuisine: "north-indian", category: "bread", isVeg: true,
    imageUrl: `${W}/thumb/4/40/Garlic_Naan_at_Mela_Restaurant_NYC_2.jpg/800px-Garlic_Naan_at_Mela_Restaurant_NYC_2.jpg`,
    tags: ["bread", "garlic"],
    attribution: "Wikimedia Commons",
  },
  {
    name: "Tandoori Roti",
    cuisine: "north-indian", category: "bread", isVeg: true,
    imageUrl: `${W}/thumb/0/04/Tandoori_Roti.jpg/800px-Tandoori_Roti.jpg`,
    aliases: ["roti", "whole wheat roti"],
    tags: ["bread"],
    attribution: "Wikimedia Commons",
  },
  {
    name: "Aloo Paratha",
    cuisine: "north-indian", category: "bread", isVeg: true,
    imageUrl: `${W}/thumb/4/4f/Aloo_paratha_November_2010.jpg/800px-Aloo_paratha_November_2010.jpg`,
    aliases: ["potato paratha"],
    tags: ["bread", "breakfast"],
    attribution: "Wikimedia Commons",
  },

  // ─── Rice ─────────────────────────────────────────────────────
  {
    name: "Jeera Rice",
    cuisine: "north-indian", category: "rice", isVeg: true,
    imageUrl: `${W}/thumb/f/f8/Jeera_Rice_at_Mela_Restaurant.jpg/800px-Jeera_Rice_at_Mela_Restaurant.jpg`,
    aliases: ["cumin rice"],
    tags: ["rice"],
    attribution: "Wikimedia Commons",
  },
  {
    name: "Veg Pulao",
    cuisine: "north-indian", category: "rice", isVeg: true,
    imageUrl: `${W}/thumb/8/82/Vegetable_pulao.jpg/800px-Vegetable_pulao.jpg`,
    aliases: ["vegetable pulao", "pulav", "veg pulav"],
    tags: ["rice"],
    attribution: "Wikimedia Commons",
  },
  {
    name: "Veg Biryani",
    cuisine: "north-indian", category: "rice", isVeg: true,
    imageUrl: `${W}/thumb/9/9c/Hyderabadi_vegetable_biryani.jpg/800px-Hyderabadi_vegetable_biryani.jpg`,
    aliases: ["vegetable biryani", "veggie biryani"],
    tags: ["rice", "biryani"],
    attribution: "Wikimedia Commons",
  },

  // ─── Non-veg ──────────────────────────────────────────────────
  {
    name: "Butter Chicken",
    cuisine: "north-indian", category: "curry", isVeg: false,
    imageUrl: `${W}/thumb/4/45/Butter_chicken_%282%29.jpg/800px-Butter_chicken_%282%29.jpg`,
    aliases: ["murgh makhani", "chicken makhani"],
    tags: ["curry", "creamy", "popular"],
    attribution: "Wikimedia Commons",
  },
  {
    name: "Chicken Tikka Masala",
    cuisine: "north-indian", category: "curry", isVeg: false,
    imageUrl: `${W}/thumb/4/4b/Chicken_Tikka_Masala_-_oven_baked.jpg/800px-Chicken_Tikka_Masala_-_oven_baked.jpg`,
    aliases: ["tikka masala", "ctm"],
    tags: ["curry", "popular"],
    attribution: "Wikimedia Commons",
  },
  {
    name: "Tandoori Chicken",
    cuisine: "north-indian", category: "starter", isVeg: false,
    imageUrl: `${W}/thumb/7/72/Tandoori_Chicken.JPG/800px-Tandoori_Chicken.JPG`,
    aliases: ["tandoori murgh"],
    tags: ["tandoor", "starter"],
    attribution: "Wikimedia Commons",
  },
  {
    name: "Chicken Tikka",
    cuisine: "north-indian", category: "starter", isVeg: false,
    imageUrl: `${W}/thumb/9/95/Chicken_Tikka.JPG/800px-Chicken_Tikka.JPG`,
    aliases: ["murgh tikka"],
    tags: ["tandoor", "starter"],
    attribution: "Wikimedia Commons",
  },
  {
    name: "Chicken Biryani",
    cuisine: "north-indian", category: "rice", isVeg: false,
    imageUrl: `${W}/thumb/6/68/Chicken_biryani.jpg/800px-Chicken_biryani.jpg`,
    aliases: ["murgh biryani", "hyderabadi biryani"],
    tags: ["rice", "biryani", "popular"],
    attribution: "Wikimedia Commons",
  },
  {
    name: "Mutton Biryani",
    cuisine: "north-indian", category: "rice", isVeg: false,
    imageUrl: `${W}/thumb/c/c8/Mutton_biryani.jpg/800px-Mutton_biryani.jpg`,
    aliases: ["lamb biryani", "gosht biryani"],
    tags: ["rice", "biryani"],
    attribution: "Wikimedia Commons",
  },
  {
    name: "Mutton Rogan Josh",
    cuisine: "north-indian", category: "curry", isVeg: false,
    imageUrl: `${W}/thumb/6/61/Rogan_Josh_with_naan_bread%2C_Kebabish_Grill%2C_Mt_Lebanon.jpg/800px-Rogan_Josh_with_naan_bread%2C_Kebabish_Grill%2C_Mt_Lebanon.jpg`,
    aliases: ["rogan josh"],
    tags: ["curry", "kashmiri"],
    attribution: "Wikimedia Commons",
  },
  {
    name: "Fish Curry",
    cuisine: "south-indian", category: "curry", isVeg: false,
    imageUrl: `${W}/thumb/b/b3/Fish_curry_kerala.jpg/800px-Fish_curry_kerala.jpg`,
    aliases: ["meen curry", "kerala fish curry"],
    tags: ["curry", "seafood"],
    attribution: "Wikimedia Commons",
  },

  // ─── South Indian ─────────────────────────────────────────────
  {
    name: "Masala Dosa",
    cuisine: "south-indian", category: "main", isVeg: true,
    imageUrl: `${W}/thumb/b/b9/Masala_Dosa_at_Sri_Krishna_Sweets%2C_Chennai.jpg/800px-Masala_Dosa_at_Sri_Krishna_Sweets%2C_Chennai.jpg`,
    aliases: ["dosa", "mysore masala dosa"],
    tags: ["breakfast", "popular"],
    attribution: "Wikimedia Commons",
  },
  {
    name: "Idli Sambar",
    cuisine: "south-indian", category: "breakfast", isVeg: true,
    imageUrl: `${W}/thumb/3/3c/Idli_with_Sambhar_and_chutneys.jpg/800px-Idli_with_Sambhar_and_chutneys.jpg`,
    aliases: ["idli", "idly"],
    tags: ["breakfast", "steamed"],
    attribution: "Wikimedia Commons",
  },
  {
    name: "Medu Vada",
    cuisine: "south-indian", category: "snack", isVeg: true,
    imageUrl: `${W}/thumb/4/47/Medu_Vada%2C_an_Indian_food.jpg/800px-Medu_Vada%2C_an_Indian_food.jpg`,
    aliases: ["vada", "ulundu vadai"],
    tags: ["fried", "snack"],
    attribution: "Wikimedia Commons",
  },
  {
    name: "Uttapam",
    cuisine: "south-indian", category: "breakfast", isVeg: true,
    imageUrl: `${W}/thumb/a/a0/Uttapam_with_chutney.jpg/800px-Uttapam_with_chutney.jpg`,
    aliases: ["uttappam", "onion uttapam"],
    tags: ["breakfast"],
    attribution: "Wikimedia Commons",
  },
  {
    name: "Sambar",
    cuisine: "south-indian", category: "curry", isVeg: true,
    imageUrl: `${W}/thumb/7/73/Sambar_with_rice.jpg/800px-Sambar_with_rice.jpg`,
    tags: ["dal", "curry"],
    attribution: "Wikimedia Commons",
  },

  // ─── Street food / chaat ──────────────────────────────────────
  {
    name: "Samosa",
    cuisine: "north-indian", category: "snack", isVeg: true,
    imageUrl: `${W}/thumb/c/c4/Samosachutney.jpg/800px-Samosachutney.jpg`,
    aliases: ["aloo samosa", "veg samosa"],
    tags: ["fried", "snack", "popular"],
    attribution: "Wikimedia Commons",
  },
  {
    name: "Pakora",
    cuisine: "north-indian", category: "snack", isVeg: true,
    imageUrl: `${W}/thumb/8/8f/Onion_pakora.jpg/800px-Onion_pakora.jpg`,
    aliases: ["pakoda", "bhajji", "onion pakora"],
    tags: ["fried", "snack"],
    attribution: "Wikimedia Commons",
  },
  {
    name: "Pav Bhaji",
    cuisine: "street", category: "main", isVeg: true,
    imageUrl: `${W}/thumb/1/1f/Pav_bhaji_at_Aaswad%2C_Dadar.jpg/800px-Pav_bhaji_at_Aaswad%2C_Dadar.jpg`,
    tags: ["street", "popular"],
    attribution: "Wikimedia Commons",
  },
  {
    name: "Vada Pav",
    cuisine: "street", category: "snack", isVeg: true,
    imageUrl: `${W}/thumb/d/d8/Vada_Pav_-_Bombay_Burger.jpg/800px-Vada_Pav_-_Bombay_Burger.jpg`,
    tags: ["street", "mumbai"],
    attribution: "Wikimedia Commons",
  },
  {
    name: "Pani Puri",
    cuisine: "street", category: "snack", isVeg: true,
    imageUrl: `${W}/thumb/c/c4/Pani_Puri_or_Gol_Gappa.jpg/800px-Pani_Puri_or_Gol_Gappa.jpg`,
    aliases: ["gol gappa", "puchka"],
    tags: ["street", "chaat"],
    attribution: "Wikimedia Commons",
  },
  {
    name: "Bhel Puri",
    cuisine: "street", category: "snack", isVeg: true,
    imageUrl: `${W}/thumb/5/56/Bhelpuri.JPG/800px-Bhelpuri.JPG`,
    tags: ["street", "chaat"],
    attribution: "Wikimedia Commons",
  },
  {
    name: "Dhokla",
    cuisine: "gujarati", category: "snack", isVeg: true,
    imageUrl: `${W}/thumb/c/c8/Dhokla.JPG/800px-Dhokla.JPG`,
    tags: ["steamed", "snack"],
    attribution: "Wikimedia Commons",
  },

  // ─── Desserts ─────────────────────────────────────────────────
  {
    name: "Gulab Jamun",
    cuisine: "indian", category: "dessert", isVeg: true,
    imageUrl: `${W}/thumb/4/41/Gulab_jamun_%28Gibe3%29.JPG/800px-Gulab_jamun_%28Gibe3%29.JPG`,
    tags: ["dessert", "sweet", "popular"],
    attribution: "Wikimedia Commons",
  },
  {
    name: "Rasgulla",
    cuisine: "bengali", category: "dessert", isVeg: true,
    imageUrl: `${W}/thumb/3/3c/Rasgulla_%28Ras_Gulla%29.jpg/800px-Rasgulla_%28Ras_Gulla%29.jpg`,
    aliases: ["roshogolla"],
    tags: ["dessert", "sweet"],
    attribution: "Wikimedia Commons",
  },
  {
    name: "Jalebi",
    cuisine: "indian", category: "dessert", isVeg: true,
    imageUrl: `${W}/thumb/0/05/Jalebi.JPG/800px-Jalebi.JPG`,
    tags: ["dessert", "sweet", "fried"],
    attribution: "Wikimedia Commons",
  },
  {
    name: "Kulfi",
    cuisine: "indian", category: "dessert", isVeg: true,
    imageUrl: `${W}/thumb/3/3f/Pista_kulfi.jpg/800px-Pista_kulfi.jpg`,
    aliases: ["pista kulfi", "malai kulfi"],
    tags: ["dessert", "frozen"],
    attribution: "Wikimedia Commons",
  },
  {
    name: "Gajar Halwa",
    cuisine: "north-indian", category: "dessert", isVeg: true,
    imageUrl: `${W}/thumb/9/92/Gajar_halwa_served_in_a_bowl.jpg/800px-Gajar_halwa_served_in_a_bowl.jpg`,
    aliases: ["carrot halwa", "gajrela"],
    tags: ["dessert", "sweet"],
    attribution: "Wikimedia Commons",
  },

  // ─── Beverages ────────────────────────────────────────────────
  {
    name: "Masala Chai",
    cuisine: "indian", category: "beverage", isVeg: true,
    imageUrl: `${W}/thumb/4/4a/Masala_Chai.jpg/800px-Masala_Chai.jpg`,
    aliases: ["chai", "spiced tea", "indian tea"],
    tags: ["beverage", "hot"],
    attribution: "Wikimedia Commons",
  },
  {
    name: "Mango Lassi",
    cuisine: "indian", category: "beverage", isVeg: true,
    imageUrl: `${W}/thumb/0/05/Mango_lassi.jpg/800px-Mango_lassi.jpg`,
    aliases: ["lassi", "sweet lassi"],
    tags: ["beverage", "cold"],
    attribution: "Wikimedia Commons",
  },
];
