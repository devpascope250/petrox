export class AppError extends Error {
  readonly isOperational = true;

  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public data?: unknown
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class BusinessError extends AppError {
  constructor(code: string, message: string, statusCode = 422, data?: unknown) {
    super(statusCode, code, message, data);
  }
}

export class NotFoundError extends AppError {
  constructor(resource = "Resource") {
    super(404, "RESOURCE_NOT_FOUND", `${resource} not found`);
  }
}

export class ConflictError extends AppError {
  constructor(code = "RESOURCE_CONFLICT", message = "The resource already exists", data?: unknown) {
    super(409, code, message, data);
  }
}

export const unauthorized = (message = "Authentication required") =>
  new AppError(401, "UNAUTHORIZED", message);
export const forbidden = (message = "Insufficient permission") =>
  new AppError(403, "FORBIDDEN", message);