import { z } from "zod";

/**
 * Shared zod primitives reused across hand-written route schemas. Keep this
 * file small and stable — anything generated from OpenAPI lives in
 * `./generated/api.ts` and is re-exported from the package index.
 */

/** Positive integer id parsed from a URL parameter (always arrives as a string). */
export const IdParam = z.coerce.number().int().positive();

/** Optional positive integer (for `?someId=` query params). */
export const OptionalIdQuery = z.coerce.number().int().positive().optional();

/** Bounded pagination — defaults match historic route behaviour. */
export const PaginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  page: z.coerce.number().int().min(1).optional(),
});

/** ISO-8601 date or date-time string. */
export const IsoDateString = z.string().min(1).refine(
  (v) => !Number.isNaN(Date.parse(v)),
  { message: "Expected an ISO date string" },
);

/** E.164-ish phone — keep loose to tolerate the variety of formats we accept. */
export const PhoneString = z.string().min(6).max(32);

/** Email with case-insensitive normalisation. */
export const EmailString = z.string().email().transform((v) => v.toLowerCase().trim());

/** A short, non-empty string (names, slugs, titles). */
export const ShortString = z.string().min(1).max(256);

/** Free-form text body (descriptions, notes). */
export const LongString = z.string().max(10_000);

/** Common `{ id: number }` URL params for `/:id` routes. */
export const IdInParams = z.object({ id: IdParam });

/** Common `{ restaurantId: number }` URL params. */
export const RestaurantIdInParams = z.object({ restaurantId: IdParam });

/** Common `{ restaurantId, id }` URL params for nested `/restaurants/:rid/.../:id`. */
export const RestaurantNestedIdParams = z.object({
  restaurantId: IdParam,
  id: IdParam,
});

/** Standard 400 error response shape produced by the `validate` middleware. */
export const ValidationErrorResponse = z.object({
  error: z.literal("Invalid request"),
  details: z.array(z.object({
    location: z.enum(["body", "query", "params"]),
    path: z.string(),
    message: z.string(),
    code: z.string(),
  })),
});
