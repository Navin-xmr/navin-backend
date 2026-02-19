import type { ErrorRequestHandler } from "express";
import { AppError } from "./errors.js";

export function errorMiddleware(): ErrorRequestHandler {
  return (err, _req, res, _next) => {
    if (err instanceof AppError) {
      return res.status(err.statusCode).json({
        error: { message: err.message, code: err.code }
      });
    }

    return res.status(500).json({
      error: { message: "Internal Server Error" }
    });
  };
}
