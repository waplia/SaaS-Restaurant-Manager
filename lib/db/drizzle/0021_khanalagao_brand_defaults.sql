-- Task #259 — Rebrand defaults from TableTrack to KhanaLagao.
--
-- Additive and reversible: only alters DEFAULT clauses on branding columns so
-- newly-provisioned tenants pick up the new brand name. Existing rows are not
-- touched, which preserves any custom appName / supportEmail / author values
-- a tenant has already configured.

ALTER TABLE "app_settings"
  ALTER COLUMN "app_name" SET DEFAULT 'KhanaLagao';

ALTER TABLE "app_settings"
  ALTER COLUMN "support_email" SET DEFAULT 'support@khanalagao.com';

ALTER TABLE "blog_posts"
  ALTER COLUMN "author" SET DEFAULT 'KhanaLagao Team';
