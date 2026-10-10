import { UserPositions } from "../../../prisma/generated/prisma/enums.js";

export interface AuthUser {
  userId: string;
  position: UserPositions;
  roleId: string;
  role: string;
  permissions: readonly string[];
  siteId: string | null;
  clientId: string | null;
}

/**
 * Staff whose view is limited to their own site: site managers, and other site
 * staff such as pompistes. A super administrator is the only staff position
 * that sees every site. Being site-bound only limits what someone can *see*;
 * what they can *do* is still decided by their role and, where it matters, by
 * checking for `siteManager` explicitly.
 */
export function isSiteBound(actor: Pick<AuthUser, "position">): boolean {
  return actor.position === "siteManager" || actor.position === "others";
}
