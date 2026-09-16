export interface ReportFilters {
  companyId: string;
  from: Date;
  to: Date;
  branchId?: string;
}

export interface SalesSummary {
  orders: number;
  grossSales: number;
  discounts: number;
  tax: number;
  netSales: number;
}