// Collision scheme: every upstream tool is exposed as "<serverSlug>__<tool>".
// Slugs are unique and cannot contain "_", so the first "__" always marks the
// boundary, even when the upstream tool name itself contains underscores.
export const TOOL_SEPARATOR = "__";

// Common MCP clients (Claude, Cursor) reject tool names longer than 64 chars.
export const MAX_TOOL_NAME_LENGTH = 64;

export function namespaceTool(serverSlug: string, tool: string): string {
  return `${serverSlug}${TOOL_SEPARATOR}${tool}`;
}

export function parseToolName(
  exposedName: string,
): { serverSlug: string; tool: string } | undefined {
  const index = exposedName.indexOf(TOOL_SEPARATOR);

  if (index <= 0) {
    return undefined;
  }

  const tool = exposedName.slice(index + TOOL_SEPARATOR.length);

  if (!tool) {
    return undefined;
  }

  return { serverSlug: exposedName.slice(0, index), tool };
}
