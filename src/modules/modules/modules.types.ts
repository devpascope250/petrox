export interface ModuleAccessRow {
  id: string;
  name: string;
  code: string;
  parentId: string | null;
  sorting: number;
  hasPermission: boolean;
}

export interface SidebarModule {
  id: string;
  name: string;
  code: string;
  sorting: number;
  children: SidebarModule[];
}
