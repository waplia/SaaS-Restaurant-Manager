import { eq, and } from "drizzle-orm";
import { db, loyaltyFamilyGroupsTable, loyaltyFamilyMembersTable, customersTable } from "../db";
import type { FamilyConfig } from "./types";

export async function getFamilyGroupForCustomer(restaurantId: number, customerId: number) {
  const [member] = await db.select().from(loyaltyFamilyMembersTable).where(and(
    eq(loyaltyFamilyMembersTable.restaurantId, restaurantId),
    eq(loyaltyFamilyMembersTable.customerId, customerId),
  ));
  if (!member) return null;
  const [group] = await db.select().from(loyaltyFamilyGroupsTable).where(eq(loyaltyFamilyGroupsTable.id, member.groupId));
  if (!group) return null;
  const members = await db.select({
    id: loyaltyFamilyMembersTable.id,
    customerId: loyaltyFamilyMembersTable.customerId,
    role: loyaltyFamilyMembersTable.role,
    name: customersTable.name,
    phone: customersTable.phone,
  })
    .from(loyaltyFamilyMembersTable)
    .leftJoin(customersTable, eq(customersTable.id, loyaltyFamilyMembersTable.customerId))
    .where(eq(loyaltyFamilyMembersTable.groupId, group.id));
  return { group, members };
}

export async function ensureGroupForPrimary(restaurantId: number, primaryCustomerId: number, name?: string) {
  const [existing] = await db.select().from(loyaltyFamilyGroupsTable).where(and(
    eq(loyaltyFamilyGroupsTable.restaurantId, restaurantId),
    eq(loyaltyFamilyGroupsTable.primaryCustomerId, primaryCustomerId),
  ));
  if (existing) return existing;
  const [created] = await db.insert(loyaltyFamilyGroupsTable).values({
    restaurantId, primaryCustomerId, name: name ?? null,
  }).returning();
  await db.insert(loyaltyFamilyMembersTable).values({
    groupId: created.id, restaurantId, customerId: primaryCustomerId, role: "primary",
  }).onConflictDoNothing();
  return created;
}

export async function addFamilyMemberByPhone(args: {
  restaurantId: number; primaryCustomerId: number; phone: string; cfg: FamilyConfig;
}): Promise<{ ok: boolean; reason?: string; memberCustomerId?: number }> {
  const group = await ensureGroupForPrimary(args.restaurantId, args.primaryCustomerId);
  const members = await db.select().from(loyaltyFamilyMembersTable).where(eq(loyaltyFamilyMembersTable.groupId, group.id));
  if (members.length >= args.cfg.maxMembers) return { ok: false, reason: "max_members" };

  const [target] = await db.select().from(customersTable).where(and(
    eq(customersTable.restaurantId, args.restaurantId),
    eq(customersTable.phone, args.phone),
  ));
  if (!target) return { ok: false, reason: "customer_not_found" };
  if (target.id === args.primaryCustomerId) return { ok: false, reason: "is_primary" };

  const [existing] = await db.select().from(loyaltyFamilyMembersTable).where(and(
    eq(loyaltyFamilyMembersTable.restaurantId, args.restaurantId),
    eq(loyaltyFamilyMembersTable.customerId, target.id),
  ));
  if (existing) return { ok: false, reason: "already_in_a_group" };

  await db.insert(loyaltyFamilyMembersTable).values({
    groupId: group.id, restaurantId: args.restaurantId,
    customerId: target.id, role: "member",
  });
  return { ok: true, memberCustomerId: target.id };
}

export async function removeFamilyMember(restaurantId: number, customerId: number) {
  await db.delete(loyaltyFamilyMembersTable).where(and(
    eq(loyaltyFamilyMembersTable.restaurantId, restaurantId),
    eq(loyaltyFamilyMembersTable.customerId, customerId),
  ));
}

export async function resolveSharedCustomerId(restaurantId: number, customerId: number, cfg: FamilyConfig): Promise<number> {
  if (!cfg.enabled || !(cfg.sharePoints || cfg.shareCashback)) return customerId;
  const grp = await getFamilyGroupForCustomer(restaurantId, customerId);
  return grp?.group.primaryCustomerId ?? customerId;
}
