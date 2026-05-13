import { File } from "@google-cloud/storage";

const ACL_POLICY_METADATA_KEY = "custom:aclPolicy";

export enum ObjectPermission {
  READ = "read",
  WRITE = "write",
}

export interface ObjectAclPolicy {
  // Restaurant id (as string) that owns this object. All members of this
  // restaurant's tenant can read.
  restaurantId: string;
  // Optional uploader user id (for audit / future fine-grained checks).
  uploaderId?: string;
  visibility: "public" | "private";
}

export async function setObjectAclPolicy(
  objectFile: File,
  aclPolicy: ObjectAclPolicy,
): Promise<void> {
  const [exists] = await objectFile.exists();
  if (!exists) {
    throw new Error(`Object not found: ${objectFile.name}`);
  }
  await objectFile.setMetadata({
    metadata: {
      [ACL_POLICY_METADATA_KEY]: JSON.stringify(aclPolicy),
    },
  });
}

export async function getObjectAclPolicy(
  objectFile: File,
): Promise<ObjectAclPolicy | null> {
  const [metadata] = await objectFile.getMetadata();
  const aclPolicy = metadata?.metadata?.[ACL_POLICY_METADATA_KEY];
  if (!aclPolicy) return null;
  try {
    return JSON.parse(aclPolicy as string) as ObjectAclPolicy;
  } catch {
    return null;
  }
}

/**
 * Decides whether a request originating from `requestingRestaurantId` may
 * access an object with `aclPolicy`. Public objects allow READ unconditionally;
 * private objects require restaurant ownership match.
 */
export function isAclOwnerOf(
  aclPolicy: ObjectAclPolicy | null,
  requestingRestaurantId: number,
  requestedPermission: ObjectPermission = ObjectPermission.READ,
): boolean {
  if (!aclPolicy) return false;
  if (aclPolicy.visibility === "public" && requestedPermission === ObjectPermission.READ) {
    return true;
  }
  return aclPolicy.restaurantId === String(requestingRestaurantId);
}
