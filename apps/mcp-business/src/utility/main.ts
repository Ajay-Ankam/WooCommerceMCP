import { startMcpHttpServer } from "../shared/http.js";
import { UTILITY_SERVER, registerUtilityTools } from "./server.js";

startMcpHttpServer({ ...UTILITY_SERVER, register: registerUtilityTools });
