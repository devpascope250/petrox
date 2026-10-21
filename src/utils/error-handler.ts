import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError, type ZodIssue } from "zod";
import { AppError } from "./errors.js";

type FastifyValidationIssue = {
  instancePath?: string;
  keyword?: string;
  message?: string;
  params?: { missingProperty?: string };
};

type ErrorLike = Error & {
  code?: string;
  statusCode?: number;
  validation?: FastifyValidationIssue[];
  issues?: ZodIssue[];
  meta?: { target?: unknown; field_name?: unknown };
};

export interface ValidationDetail {
  field: string;
  code: string;
  message: string;
}

export interface ErrorEnvelope {
  success: false;
  error: {
    statusCode: number;
    code: string;
    message: string;
    requestId: string;
    details?: ValidationDetail[];
    data?: unknown;
  };
}

const prismaErrors: Record<string, { statusCode: number; code: string; message: string }> = {
  P2002: { statusCode: 409, code: "RESOURCE_CONFLICT", message: "A record with these values already exists" },
  P2003: { statusCode: 409, code: "RELATION_CONFLICT", message: "The operation conflicts with a related record" },
  P2025: { statusCode: 404, code: "RESOURCE_NOT_FOUND", message: "The requested resource was not found" },
  P1000: { statusCode: 503, code: "DATABASE_UNAVAILABLE", message: "Database service is unavailable" },
  P1001: { statusCode: 503, code: "DATABASE_UNAVAILABLE", message: "Database service is unavailable" }
};

/**
 * Which columns a unique constraint was violated on. Prisma hands these over
 * differently per database: a list of field names, or — on MySQL — the index's
 * own name, `User_phone_key`. Both come back here as field names, so a client
 * can put the message on the input that holds the duplicate.
 */
function conflictedFields(target: unknown): string[] {
  if (Array.isArray(target)) return target.map(String);
  if (typeof target !== "string") return [];
  // `<Model>_<field>[_<field>…]_key`, else the name as it stands.
  const named = /^[A-Za-z]\w*?_(\w+)_key$/.exec(target);
  return named ? named[1].split("_") : [target];
}

function formatZodPath(path: PropertyKey[]): string {
  if (path.length === 0) return "_root";
  return path.reduce<string>((result, segment) =>
    typeof segment === "number"
      ? `${result}[${segment}]`
      : result ? `${result}.${String(segment)}` : String(segment), "");
}

function zodDetails(issues: ZodIssue[] | undefined): ValidationDetail[] {
  return (issues ?? []).map((issue) => ({
    field: formatZodPath(issue.path),
    code: issue.code,
    message: issue.message
  }));
}

function fastifyDetails(issues: FastifyValidationIssue[]): ValidationDetail[] {
  return issues.map((issue) => {
    const path = (issue.instancePath ?? "").replace(/^\//, "").replaceAll("/", ".");
    const field = [path, issue.params?.missingProperty].filter(Boolean).join(".") || "_root";
    return {
      field,
      code: issue.keyword ?? "invalid",
      message: issue.message ?? "Invalid value"
    };
  });
}

export function normalizeError(error: ErrorLike, requestId: string): ErrorEnvelope {
  if (error instanceof ZodError || error.name === "ZodError") {
    return { success: false, error: { statusCode: 400, code: "VALIDATION_ERROR", message: "The request contains invalid data", requestId, details: zodDetails(error.issues) } };
  }
  if (error.validation) {
    return { success: false, error: { statusCode: 400, code: "VALIDATION_ERROR", message: "The request contains invalid data", requestId, details: fastifyDetails(error.validation) } };
  }
  if (error instanceof AppError) {
    return { success: false, error: { statusCode: error.statusCode, code: error.code, message: error.message, requestId, ...(error.data === undefined ? {} : { data: error.data }) } };
  }
  if (error.code && prismaErrors[error.code]) {
    const mapped = prismaErrors[error.code];
    const data = error.code === "P2002" && error.meta?.target
      ? { fields: conflictedFields(error.meta.target) }
      : undefined;
    return { success: false, error: { ...mapped, requestId, ...(data ? { data } : {}) } };
  }
  if (error.statusCode === 429) {
    return { success: false, error: { statusCode: 429, code: "RATE_LIMIT_EXCEEDED", message: "Too many requests; please try again later", requestId } };
  }
  if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
    return { success: false, error: { statusCode: error.statusCode, code: error.code ?? "REQUEST_ERROR", message: error.message, requestId } };
  }
  return { success: false, error: { statusCode: 500, code: "INTERNAL_ERROR", message: "An unexpected error occurred", requestId } };
}

export function globalErrorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  const payload = normalizeError(error, request.id);
  const log = payload.error.statusCode >= 500 ? request.log.error.bind(request.log) : request.log.warn.bind(request.log);
  log({ err: error, errorCode: payload.error.code }, "request failed");
  return reply.code(payload.error.statusCode).send(payload);
}