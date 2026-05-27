// Top-level Profile route. Reuses the owner profile screen so every role
// gets the same edit-name / change-password / sign-out experience without
// duplicating the form. The component itself only relies on the
// authenticated user, not on owner-only data, so it's safe to render
// outside the (owner) stack.
export { default } from "./(owner)/profile";
