import { startMcpHttpServer } from "../shared/http.js";
import { ANALYTICS_SERVER, registerAnalyticsTools } from "./server.js";

startMcpHttpServer({ ...ANALYTICS_SERVER, register: registerAnalyticsTools });
