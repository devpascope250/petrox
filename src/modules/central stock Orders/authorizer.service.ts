import { AuthorizerRepository } from "./authorizer.repository.js";
import type { AuthorizerSchema } from "./authorizer.schema.js";

export class AuthorizerService {
  constructor(private repo: AuthorizerRepository) {}
  list() { return this.repo.list(); }
  find(id: string) { return this.repo.find(id); }
  create(data: AuthorizerSchema) { return this.repo.create(data); }
  update(id: string, data: AuthorizerSchema) { return this.repo.update(id, data); }
  changeStatus(id: string) { return this.repo.changeStatus(id); }
  delete(id: string) { return this.repo.delete(id); }
  pendingForRole(roleId: string, userId: string) { return this.repo.pendingForRole(roleId, userId); }
  approveLoadingOrder(loadingOrderId: string, roleId: string, userId: string) {
    return this.repo.approveLoadingOrder(loadingOrderId, roleId, userId);
  }
}
