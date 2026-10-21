import { z } from "zod";
import { emailSchema, opaqueTokenSchema, passwordSchema, pinSchema } from "../../shared/validation/index.js";

export const loginSchema = z.object({ email: emailSchema, password: passwordSchema });
export const pinLoginSchema = z.object({ email: emailSchema, pin: pinSchema });
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
