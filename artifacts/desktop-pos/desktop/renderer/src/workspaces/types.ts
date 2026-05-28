/**
 * Shared types for the role-based desktop workspace system.
 *
 * A *workspace* is the top-level shell a user lands in after sign-in
 * (Cashier POS, Manager Office, Inventory, etc.). Each workspace owns
 * its own left-nav and module screens; the router picks the workspace
 * from the user's role, permissions and enabled modules.
 */
import type { User } from "../../../shared/ipc-contract";

export type WorkspaceKey =
  | "cashier"
  | "manager"
  | "inventory"
  | "accountant"
  | "marketing"
  | "delivery";

export interface WorkspaceMeta {
  key: WorkspaceKey;
  label: string;
  /** Short subtitle shown in the role-switcher and "no workspace" fallback. */
  description: string;
  /** Single-character glyph used for the avatar bubble. */
  glyph: string;
  /** Brand accent — defaults to the platform orange when omitted. */
  accent?: string;
}

export interface NavItem {
  key: string;
  label: string;
  /** Group label shown in the left-nav and palette. */
  group: string;
  /** Inline SVG / element. Leave undefined for a dot fallback. */
  icon?: React.ReactNode;
  /** Required permission(s) — hidden when the user has none of them. */
  requiredPermissions?: string[];
  /** Required module/plan flag(s) — hidden when not enabled for the tenant. */
  requiredModules?: string[];
  /** Optional search aliases for the command palette. */
  aliases?: string[];
  /** If true the item shows in the nav but renders the "coming soon" empty
   *  state instead of an actual module. Used everywhere in the foundation. */
  comingSoon?: boolean;
}

/** Per-user / per-tenant context the nav and router use to gate items. */
export interface AccessContext {
  user: User;
  /** Permissions the signed-in user has — derived from `user.role` plus
   *  any explicit permissions returned by the backend. Permission strings
   *  are kept loose (no enum) so new permissions don't require a renderer
   *  rebuild. */
  permissions: Set<string>;
  /** Modules / plan flags enabled for the active tenant. */
  modules: Set<string>;
}
