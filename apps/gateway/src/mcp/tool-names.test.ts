import assert from "node:assert/strict";
import test from "node:test";

import { namespaceTool, parseToolName } from "./tool-names.js";

test("namespaces tools by server slug", () => {
  assert.equal(namespaceTool("woocommerce", "list_orders"), "woocommerce__list_orders");
});

test("parses on the first separator so tool names may contain underscores", () => {
  assert.deepEqual(parseToolName("my-server__get__thing"), {
    serverSlug: "my-server",
    tool: "get__thing",
  });
});

test("rejects names without a server or tool part", () => {
  assert.equal(parseToolName("list_orders"), undefined);
  assert.equal(parseToolName("__list_orders"), undefined);
  assert.equal(parseToolName("woocommerce__"), undefined);
});
