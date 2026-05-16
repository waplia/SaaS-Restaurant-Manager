ALTER TABLE "feedback_wall_items"
  ADD CONSTRAINT "feedback_wall_items_source_one_of"
  CHECK (num_nonnulls("feedback_id", "external_review_id") = 1);
