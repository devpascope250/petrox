import { z } from "zod";
import { emailSchema, opaqueTokenSchema, passwordSchema, pinSchema } from "../../shared/validation/index.js";

export const loginSchema = z.object({ email: emailSchema, password: passwordSchema });
export const pinLoginSchema = z.object({ email: emailSchema, pin: pinSchema });
/**
 * The emailed code that finishes a login. Exactly six digits — anything else
 * is refused before a database row is touched.
 */
export const verifyOtpSchema = z.object({
  challengeId: z.uuid(),
  code: z.string().trim().regex(/^\d{6}$/, "The code is six digits"),
});
export const resendOtpSchema = z.object({ challengeId: z.uuid() });
export const resetRequestSchema = z.object({ email: emailSchema });
export const resetPasswordSchema = z.object({ token: opaqueTokenSchema, password: passwordSchema });
/** Changing your own password: the current one proves it is you. */
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Your current password is required"),
  newPassword: passwordSchema,
}).refine((data) => data.currentPassword !== data.newPassword, {
  message: "The new password must differ from the current one",
  path: ["newPassword"],
});
export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
