import type { AuthUser } from "../../../shared/auth/context-user.js";
import { forbidden } from "../../../utils/errors.js";

/**
 * Which sites an admin may manage POS devices for. A super administrator
 * manages every site; a site manager only his own. Nobody else, whatever
 * permissions their role holds.
 */
export function assertCanManageSite(actor: AuthUser, siteId: string) {
  if (actor.position === "superAdmin") return;
  if (actor.position === "siteManager" && actor.siteId && actor.siteId === siteId) return;
  throw forbidden("You can only manage POS devices for your own site");
}
