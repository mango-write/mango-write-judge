import { z } from "zod";

/** 统一错误码。跨比赛资源一律 404 not_found，不泄露资源是否存在。 */
export const errorCodes = [
  "unauthorized",
  "forbidden",
  "not_found",
  "validation_error",
  "revision_conflict",
  "idempotency_conflict",
  "evaluation_unlock_required",
  "event_closed",
  "event_not_draft",
  "invalid_weights",
  "incomplete_scores",
  "rate_limited",
  "slug_taken",
  "reveal_confirm_required",
  "limit_exceeded",
  "payload_too_large",
  "bad_csv",
  "internal_error",
] as const;

export type ErrorCode = (typeof errorCodes)[number];

export const ErrorEnvelope = z.object({
  error: z.object({
    code: z.enum(errorCodes),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;

export const httpStatusOf: Record<ErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  validation_error: 400,
  revision_conflict: 409,
  idempotency_conflict: 409,
  evaluation_unlock_required: 409,
  event_closed: 409,
  event_not_draft: 409,
  invalid_weights: 422,
  incomplete_scores: 422,
  rate_limited: 429,
  slug_taken: 409,
  reveal_confirm_required: 428,
  limit_exceeded: 422,
  payload_too_large: 413,
  bad_csv: 422,
  internal_error: 500,
};
