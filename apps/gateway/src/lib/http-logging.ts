import { randomUUID } from "node:crypto";
import { pinoHttp } from "pino-http";
import type { Logger } from "pino";

import { logger } from "./logger.js";

export function createHttpLogger(log: Logger = logger) {
  return pinoHttp({
    logger: log,

    genReqId: (_req, res) => {
      const requestId = randomUUID();
      res.setHeader("X-Request-ID", requestId);
      return requestId;
    },

    serializers: {
      req: (req) => ({
        id: req.id,
        method: req.method,
        path: req.url?.split("?")[0],
      }),

      res: (res) => ({
        statusCode: res.statusCode,
      }),
    },
  });
}

export const httpLogger = createHttpLogger();
