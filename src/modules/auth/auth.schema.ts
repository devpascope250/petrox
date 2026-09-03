import { z } from "zod";
import { emailSchema, opaqueTokenSchema, passwordSchema, pinSchema } from "../../shared/validation/index.js";

export const loginSchema = z.object({ email: emailSchema, password: passwordSchema });
export const pinLoginSchema = z.object({ email: emailSchema, pin: pinSchema });
export const resetRequestSchema = z.object({ email: emailSchema });
export const resetPasswordSchema = z.object({ token: opaqueTokenSchema, password: passwordSchema });
export type LoginInput = z.infer<typeof loginSchema>;
