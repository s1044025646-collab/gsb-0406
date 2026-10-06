export type ErrorCode =
  | "INVALID_CONTAINER"
  | "EMPTY_DIMENSION"
  | "DUPLICATE_ID"
  | "NEGATIVE_WEIGHT"
  | "NON_FINITE_VALUE"
  | "INVALID_ID"
  | "TOO_MANY_ITEMS"
  | "INVALID_TOLERANCE"
  | "NOT_FOUND"
  | "BAD_REQUEST";

export const MAX_ITEMS = 10000;

export class ApiError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public status = 400
  ) {
    super(message);
    this.name = "ApiError";
  }
}
