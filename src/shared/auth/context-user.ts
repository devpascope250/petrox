export interface AuthUser {
  userId: string;
  roleId: string;
  role: string;
  permissions: readonly string[];
}
