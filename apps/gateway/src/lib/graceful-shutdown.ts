import type { Server } from "node:http";
import type { Logger } from "pino";

type ShutdownSignal = "SIGTERM" | "SIGINT";

interface SignalSource {
  once(event: ShutdownSignal, listener: () => void): unknown;
}

interface ShutdownOptions {
  timeoutMs?: number;
  signalSource?: SignalSource;
  onExit?: (code: number) => void;
}

export function registerGracefulShutdown(
  server: Server,
  logger: Logger,
  options: ShutdownOptions = {},
): void {
  const {
    timeoutMs = 10000,
    signalSource = process,
    onExit = (code: number) => {
      process.exitCode = code;
    },
  } = options;

  let shuttingDown = false;
  let finished = false;

  function finish(code: number): void {
    if (finished) return;

    finished = true;
    onExit(code);
  }

  function shutdown(signal: ShutdownSignal): void {
    if (shuttingDown) return;

    shuttingDown = true;

    logger.info({ signal }, "Gateway shutdown initiated");

    const timeout = setTimeout(() => {
      logger.error("Graceful shutdown timed out");

      finish(1);

      // Force-close remaining HTTP connections.
      server.closeAllConnections();
    }, timeoutMs);

    server.close((error) => {
      clearTimeout(timeout);

      if (error) {
        logger.error({ err: error }, "HTTP server shutdown failed");
        finish(1);
      } else {
        logger.info("Gateway shut down gracefully");
        finish(0);
      }
    });
  }

  signalSource.once("SIGTERM", () => shutdown("SIGTERM"));
  signalSource.once("SIGINT", () => shutdown("SIGINT"));
}
