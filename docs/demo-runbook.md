# Demo runbook (local Kind)

Two users, one gateway. Everything goes through Traefik:

```powershell
kubectl port-forward -n traefik svc/traefik 8080:80
```

| URL | What |
|---|---|
| http://ajay.localtest.me:8080 | Dashboard, `/api`, `/invite/<token>` |
| http://ajay.localtest.me:8080/mcp | Single MCP endpoint (Bearer API key) |
| http://store.localtest.me:8080 | WooCommerce storefront |

Demo records are named **"Urumi Demo Mug"** so they are easy to tell apart from existing data.

## 1. Admin (browser window A)

1. Log in as the admin.
2. **AI Chat:** `Create a product called "Urumi Demo Mug" priced 299 INR, published.`
   Approve the confirmation card. The tool chip shows `woocommerce__create_product`.
3. Open the storefront, find **Urumi Demo Mug**, add it to the cart and check out with
   **Cash on delivery** (guest checkout, any test name and address).
4. **AI Chat:** `What orders came in today?` The new order appears with Cash on delivery.
5. **Team:** invite the member (role *member*). Copy the one-time invite link.

## 2. Member (private window B)

1. Open the invite link and set a password. You land in the dashboard as the member.
2. **API Keys:** create a key and copy it (it is shown once).
3. Connect an external MCP client. Pick one of the two options.

   **Claude Code.** Paste the key when running the command. The key is stored in the user config, never in this repository:
   ```powershell
   claude mcp add --transport http ajay-gateway http://ajay.localtest.me:8080/mcp --header "Authorization: Bearer <member key>"
   ```
   Then ask in Claude Code:
   - `List today's WooCommerce orders using the ajay-gateway tools`
   - `Summarize those orders' sales and give me a 10% discount price for the mug`

   This uses woocommerce, analytics and utility tools in one workflow.

   **MCP Inspector.** Run `npx @modelcontextprotocol/inspector@2.10.1`.
   - Transport: Streamable HTTP
   - URL: `http://ajay.localtest.me:8080/mcp`
   - Header: `Authorization: Bearer <member key>`
   - Use the UI, not `--cli`. The CLI sends tool arguments as strings, so it cannot pass the `orders` array.
4. Role restriction: the member sees **14** tools. The admin sees 16: `woocommerce__create_product` and
   `woocommerce__update_order_status` are admin-only. Asking the client to create a product fails with
   "requires the admin role", and the call is audited as *denied*.

## 3. Security (admin window A, member client B)

1. **Audit:** the member's calls are listed under the member's email, the admin's under the admin's.
2. **Revoke:** the member revokes their key on the API Keys page. The next client call fails with HTTP 401
   `API_KEY_REVOKED`. Some clients then offer an OAuth sign-in, which is expected because the gateway
   supports API keys only.
3. **Disable a server:** the admin opens Servers, opens *Utility* and clicks Disable. Re-list tools in the client
   (with a new member key): 9 tools, no `utility__*`, and WooCommerce still works. Then **re-enable** it.
4. **Failure isolation** (optional, restarts one pod):
   ```powershell
   kubectl scale deploy/ajay-mcp-analytics -n ajay-store --replicas=0
   ```
   Within about 5 s the dashboard shows *Analytics: Unreachable*, and the other servers' tools keep working.
   Restore it:
   ```powershell
   kubectl scale deploy/ajay-mcp-analytics -n ajay-store --replicas=1
   ```
