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
