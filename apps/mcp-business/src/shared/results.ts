import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// Tools compute plain objects; this wraps them as MCP results and turns
// domain errors (e.g. "discount exceeds price") into clear tool errors.
export function toolHandler<A>(compute: (args: A) => unknown) {
  return async (args: A): Promise<CallToolResult> => {
    try {
      return {
        content: [{ type: "text", text: JSON.stringify(compute(args), null, 2) }],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          { type: "text", text: error instanceof Error ? error.message : String(error) },
        ],
      };
    }
  };
}
