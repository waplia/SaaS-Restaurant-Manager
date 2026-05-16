ALTER TABLE "restaurants" ADD COLUMN IF NOT EXISTS "enable_voice_ordering" boolean DEFAULT false NOT NULL;
