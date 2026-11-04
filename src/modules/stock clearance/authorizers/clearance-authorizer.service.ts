import { ClearanceAuthorizerMemberRepository } from "./clearance-authorizer.repository.js";
import { ClearanceAuthorizerMemberSchema } from "./clearance-authorizer.schema.js";

export class ClearanceAuthorizerMemberService {
  constructor(private repo: ClearanceAuthorizerMemberRepository) {}

  list() { return this.repo.list(); }
  find(id: string) { return this.repo.find(id); }
  create(input: ClearanceAuthorizerMemberSchema) { return this.repo.create(input); }
  update(id: string, input: ClearanceAuthorizerMemberSchema) { return this.repo.update(id, input); }
  updateStatus(id: string) { return this.repo.changeStatus(id); }
  delete(id: string) { return this.repo.delete(id); }
}
