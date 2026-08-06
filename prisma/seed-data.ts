export interface ModuleSeed {
  name: string;
  code: string;
  sorting: number;
  parentCode?: string;
  permissions: ReadonlyArray<{ name: string; code: string; description: string }>;
}

export const moduleSeeds: ReadonlyArray<ModuleSeed> = [
  {
    name: "Dashboard",
    code: "dashboard",
    sorting: 10,
    permissions: [
      { name: "View dashboard", code: "dashboard.read", description: "View the main dashboard" }
    ]
  },
  {
    name: "Administration",
    code: "administration",
    sorting: 90,
    permissions: [
      { name: "Access administration", code: "administration.access", description: "Display the administration section" }
    ]
  },
  {
    name: "Users",
    code: "users",
    parentCode: "administration",
    sorting: 10,
    permissions: [
      { name: "Read users", code: "users.read", description: "View users" },
      { name: "Create users", code: "users.create", description: "Create users" },
      { name: "Reset user passwords", code: "users.reset_password", description: "Issue password-reset tokens" }
    ]
  },
  {
    name: "Roles and permissions",
    code: "roles",
    parentCode: "administration",
    sorting: 20,
    permissions: [
      { name: "Read roles", code: "roles.read", description: "View roles and their permissions" },
      { name: "Manage roles", code: "roles.manage", description: "Create and modify roles" }
    ]
  }
];
