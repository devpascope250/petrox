import type { FastifyRequest } from "fastify";
import { parseInput } from "../../../shared/validation/index.js";
import { AppError } from "../../../utils/errors.js";
import { deviceSite } from "../auth/device-auth.js";
import { readMobileForm } from "../transactions/transaction-form.js";
import type { ReceiptCompany } from "../transactions/transactions.service.js";
import { CouponSaleRepository } from "./coupon-sale.repository.js";
import {
  cancelCouponSaleSchema, confirmCouponSaleSchema, couponClientsQuerySchema, initiateCouponSaleSchema, verifyClientSchema,
} from "./coupon-sale.schema.js";

/** A JSON body, or the text fields of a multipart form. */
async function fieldsOf(request: FastifyRequest) {
  return request.isMultipart() ? (await readMobileForm(request, [], 0)).fields : request.body ?? {};
}

export class CouponSaleService {
  constructor(
    private repo: CouponSaleRepository,
    private attendant: (phone: string, pin: string, siteId: string) => Promise<string>,
    private receiptCompany: ReceiptCompany = async () => null,
  ) {}

  clients(request: FastifyRequest) {
    deviceSite(request);
    return this.repo.clients(parseInput(couponClientsQuerySchema, request.query).search);
  }

  async verifyClient(request: FastifyRequest) {
    deviceSite(request);
    const { clientId, pin } = parseInput(verifyClientSchema, await fieldsOf(request));
    return this.repo.verifyClient(clientId, pin);
  }

  /**
   * Multipart: the fields, the picture of the pump display as `displayPicture`
   * (required) and the picture of the car's plate as `platePicture` (optional).
   */
  async initiate(request: FastifyRequest) {
    const siteId = deviceSite(request);
    const form = await readMobileForm(request, [
      { field: /^displayPicture$/, kind: "image" },
      { field: /^platePicture$/, kind: "image" },
    ], 2);
    try {
      const input = parseInput(initiateCouponSaleSchema, form.fields);
      if (!form.files.displayPicture) {
        throw new AppError(400, "DISPLAY_PICTURE_REQUIRED", "A coupon sale needs a picture of the pump display (displayPicture)");
      }
      return await this.repo.initiate(
        { ...input, displayPictureUrl: form.files.displayPicture, platePictureUrl: form.files.platePicture },
        siteId, request.device!.deviceId,
      );
    } catch (error) {
      // Nothing was recorded, so the pictures it came with are not kept.
      await form.discard();
      throw error;
    }
  }

  /** JSON or form fields. Returns the sale with the company it is printed under. */
  async confirm(request: FastifyRequest, code: string) {
    const siteId = deviceSite(request);
    const { phone, pin, ...input } = parseInput(confirmCouponSaleSchema, await fieldsOf(request));
    const doneBy = await this.attendant(phone, pin, siteId);
    const [sale, company] = await Promise.all([this.repo.confirm(code, siteId, input, doneBy), this.receiptCompany()]);
    return { ...sale, company };
  }

  async cancel(request: FastifyRequest, code: string) {
    const siteId = deviceSite(request);
    return this.repo.cancel(code, siteId, parseInput(cancelCouponSaleSchema, await fieldsOf(request)).reason);
  }
}
