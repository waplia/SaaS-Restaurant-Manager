ALTER TABLE "ai_menu_import_items" ADD COLUMN IF NOT EXISTS "image_status" text NOT NULL DEFAULT 'queued';
ALTER TABLE "ai_menu_import_items" ADD COLUMN IF NOT EXISTS "image_error" text;
