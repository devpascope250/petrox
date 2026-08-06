import { z } from "zod";
import { emailSchema, opaqueTokenSchema, passwordSchema, pinSchema, uuidSchema } from "../../shared/validation/index.js";

export const loginSchema = z.object({ email: emailSchema, password: passwordSchema });
export const pinLoginSchema = z.object({ email: emailSchema, pin: pinSchema });
export const refreshSchema = z.object({ refreshToken: opaqueTokenSchema });
export const logoutSchema = refreshSchema;
export const resetRequestSchema = z.object({ userId: uuidSchema });
export const resetPasswordSchema = z.object({ token: opaqueTokenSchema, password: passwordSchema });
export type LoginInput = z.infer<typeof loginSchema>;