export interface ItemsAccessRow {
  id: string;
  name: string;
  descriptions?: string;
  parentId?: string | null;
  baseUnitId?: string | null;
}

export interface ItemsList {
  id: string;
  name: string;
  descriptions?: string;
  baseUnitId?: string;
  items: ItemsList[];
}
