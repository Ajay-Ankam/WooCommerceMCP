import type { ErrorRequestHandler, RequestHandler } from "express";

import { AppError } from "../lib/app-error.js";

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(
    new AppError(
      404,
      "ROUTE_NOT_FOUND",
      `Route ${req.method} ${req.path} not found`,
    ),
  );
};

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  req,
  res,
  _next,
) => {
  const isAppError = error instanceof AppError;

  const statusCode = isAppError ? error.statusCode : 500;

  const code = isAppError ? error.code : "INTERNAL_SERVER_ERROR";

  const message = isAppError ? error.message : "An unexpected error occurred";

  req.log.error(
    {
      err: error,
      statusCode,
    },
    "Gateway request failed",
  );

  res.status(statusCode).json({
    error: {
      code,
      message,
      requestId: req.id,
    },
  });
};
