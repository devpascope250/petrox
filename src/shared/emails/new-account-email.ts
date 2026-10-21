import { emailService } from "../../utils/emailService.js";

/** How each position is named to the person it was created for. */
const POSITION_LABELS: Record<string, string> = {
  superAdmin: "Super administrator",
  siteManager: "Site manager",
  clientAdmin: "Client administrator",
  clientUser: "Client user",
  others: "Staff",
};

/**
 * Tells a newly created user the account they can sign in with — the email
 * address and the password it was created with, and the PIN when one was
 * generated for them.
 *
 * Never fails the creation: the user exists either way, and an administrator
 * can send the details again by setting a new password. The failure is logged.
 */
export function emailNewAccount(
  user: { email: string; firstName: string; position: string | null },
  credentials: { password: string; pin?: string | null },
) {
  emailService
    .sendNewAccountEmail(user.email, user.firstName, {
      password: credentials.password,
      pin: credentials.pin,
      accountType: POSITION_LABELS[user.position ?? ""] ?? "Account",
    })
    .catch((error) => {
      console.error(`Could not email the new account details to ${user.email}:`, error);
    });
}
