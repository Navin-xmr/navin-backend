import type { RequestHandler } from "express";
import type { ZodSchema } from "zod";
import { AppError } from "../http/errors.js";

export function validate(input: {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}): RequestHandler {
  return (req, _res, next) => {
    try {
      if (input.body) req.body = input.body.parse(req.body);
      if (input.query) req.query = input.query.parse(req.query);
      if (input.params) req.params = input.params.parse(req.params);
      next();
    } catch {
      next(new AppError(400, "Validation error", "VALIDATION_ERROR"));
    }
  };
}
