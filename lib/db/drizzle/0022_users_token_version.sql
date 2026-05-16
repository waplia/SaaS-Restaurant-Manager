-- Task #279 — Stateful session revocation.
--
-- Adds a monotonically-increasing `token_version` counter to every user
-- row. The current value is embedded in each issued JWT as `tv`; the
-- auth middleware re-checks it on every request and rejects tokens
-- whose stamp no longer matches. Bumping the column on logout or
-- password reset therefore invalidates every existing access AND
-- refresh token for that user immediately, without us having to
-- maintain a server-side revocation list.
--
-- Additive, NOT NULL with DEFAULT 0 so backfill is instantaneous on
-- existing rows. The UPDATE that follows bumps every existing user by
-- one as a cutover step so that any pre-existing JWT (which lacks the
-- `tv` claim) is treated as stale by the post-deploy middleware.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "token_version" integer NOT NULL DEFAULT 0;
UPDATE "users" SET "token_version" = "token_version" + 1;
