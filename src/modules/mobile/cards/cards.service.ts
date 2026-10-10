import { AppError, NotFoundError } from "../../../utils/errors.js";
import { DEFAULT_CARD_PIN, verifyCardPin } from "../../cards/card-pin.js";
import { MobileCardsRepository } from "./cards.repository.js";
import type { VerifyCardPinInput } from "./cards.schema.js";

export class MobileCardsService {
  /** `pinSecret` is `PIN_HMAC_SECRET`, which card PINs are hashed with. */
  constructor(private repo: MobileCardsRepository, private pinSecret: string) {}

  async findCard(id: string) {
    const card = await this.repo.findCardBySerialNumber(id);
    if (!card) throw new NotFoundError("Card");
    return card;
  }

  /**
   * Checks a card's PIN. A card that is unknown, not assigned, or held by an
   * inactive client reads as not found; a wrong PIN is refused with
   * `INVALID_PIN`. The PIN itself is never returned or logged.
   */
  async verifyPin(input: VerifyCardPinInput) {
    const assignment = await this.repo.findAssignmentForPin(input);
    if (!assignment || !assignment.client.status) throw new NotFoundError("Card");
    if (!verifyCardPin(input.pin, assignment.pin, this.pinSecret)) {
      throw new AppError(422, "INVALID_PIN", "Wrong PIN");
    }
    return {
      valid: true as const,
      cardCopyId: assignment.id.toString(),
      clientId: assignment.clientId,
      isCopy: assignment.cardCopyId !== null,
      /** Still the default PIN: the holder should be asked to change it. */
      isDefaultPin: verifyCardPin(DEFAULT_CARD_PIN, assignment.pin, this.pinSecret),
    };
  }
}
