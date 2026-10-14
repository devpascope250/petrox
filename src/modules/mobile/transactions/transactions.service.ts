import type { FastifyRequest } from "fastify";
import { parseInput } from "../../../shared/validation/index.js";
import { deviceSite } from "../auth/device-auth.js";
import { readMobileForm } from "./transaction-form.js";
import { MobileTransactionsRepository } from "./transactions.repository.js";
import {
  cancelTransactionSchema, confirmTransactionSchema, initiateTransactionSchema, listTransactionsQuerySchema,
} from "./transactions.schema.js";

const REFERENCE_DOC = /^referenceDoc\.(\d+)$/;

export class MobileTransactionsService {
  constructor(private repo: MobileTransactionsRepository) {}

  list(request: FastifyRequest) {
    return this.repo.list(deviceSite(request), parseInput(listTransactionsQuerySchema, request.query).status);
  }

  find(request: FastifyRequest, code: string) {
    return this.repo.find(code, deviceSite(request));
  }

  /** Form fields as listed in the schema; the `platePicture` file becomes `platePictureUrl`. */
  async initiate(request: FastifyRequest) {
    const form = await readMobileForm(request, [{ field: /^platePicture$/, kind: "image" }], 1);
    try {
      const { phone, pin, ...input } = parseInput(initiateTransactionSchema, form.fields);
      const siteId = deviceSite(request);
      const attendantId = await this.repo.attendant(phone, pin, siteId);
      return await this.repo.initiate({ ...input, platePictureUrl: form.files.platePicture }, siteId, request.device!.deviceId, attendantId);
    } catch (error) {
      // Nothing was recorded, so the pictures it came with are not kept.
      await form.discard();
      throw error;
    }
  }

  /**
   * Form fields as listed in the schema; the `displayPicture` file becomes
   * `displayPictureUrl`, and `referenceDoc.<n>` the document of payment `n`.
   */
  async confirm(request: FastifyRequest, code: string) {
    const siteId = deviceSite(request);
    const form = await readMobileForm(request, [
      { field: /^displayPicture$/, kind: "image" },
      { field: REFERENCE_DOC, kind: "document" },
    ]);
    try {
      const input = parseInput(confirmTransactionSchema, form.fields);
      const referenceDocs: Record<number, string> = {};
      for (const [field, url] of Object.entries(form.files)) {
        const index = REFERENCE_DOC.exec(field)?.[1];
        if (index !== undefined) referenceDocs[Number(index)] = url;
      }
      const doneBy = await this.repo.attendant(input.phone, input.pin, siteId);
      return await this.repo.confirm(code, siteId, { ...input, displayPictureUrl: form.files.displayPicture, referenceDocs }, doneBy);
    } catch (error) {
      await form.discard();
      throw error;
    }
  }

  /** Accepts the reason as form data or JSON. */
  async cancel(request: FastifyRequest, code: string) {
    const siteId = deviceSite(request);
    const fields = request.isMultipart() ? (await readMobileForm(request, [], 0)).fields : request.body ?? {};
    return this.repo.cancel(code, siteId, parseInput(cancelTransactionSchema, fields).reason);
  }
}
