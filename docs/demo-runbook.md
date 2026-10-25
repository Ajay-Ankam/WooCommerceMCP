# Demo guide (5–7 minutes)

A walkthrough of the production deployment, with what to show and what to say. Each step has a fallback on the local Kind cluster (see the README).

## Before recording

- Two browser windows: **A** logged in as the admin, **B** a private window for the member.
- In window A, open **Team**, invite a member and accept the invite in window B.
- A terminal with SSH access to the VPS, and `kubectl` working there.
- The store starts empty; the product is created live.

Name demo records **"Urumi Demo Mug"** so they are easy to spot.

## 1. The problem (0:00–0:45)

Show the architecture diagram in the [README](../README.md#architecture).

> Teams want AI assistants to work with the store, but handing every client the store's REST key gives no accountability and no way to remove one person. The gateway gives everyone one URL and a personal key, applies roles, and logs every call. The store credential never leaves the cluster.

## 2. The cluster (0:45–1:30)

```bash
kubectl get nodes -o wide
kubectl -n ajay-store get pods,pvc,ingress,certificate
helm list -A
```

Expected: one Ready node, six pods Ready, three PVCs Bound, two Ingresses, two certificates `True`.

> One Helm chart installs everything. MariaDB is a StatefulSet; the gateway and WordPress keep their data on volumes. Images are pinned by digest to a commit on `main`, built by CI.

## 3. Store and TLS (1:30–2:00)

Open `http://store.ajayankam.tech`. It redirects to HTTPS with a Let's Encrypt certificate. The shop is empty.

> cert-manager issued the certificates through HTTP-01. WordPress was installed with WP-CLI before any Ingress existed, so the installer was never public.

## 4. Dashboard and servers (2:00–2:45)

Window A, https://ajay.ajayankam.tech, **Servers**: WooCommerce Store, Utility and Sales Analytics are Connected, with 6, 5 and 5 tools.

> These are three separate MCP servers. The gateway exposes them through one endpoint as `server__tool`, so two servers can both have `get_server_info` without a clash.

## 5. Admin creates a product through chat (2:45–3:30)

Window A, **Chat**: `Create a product called "Urumi Demo Mug" priced 299 INR, published.`

Approve the card. The tool chip shows `woocommerce__create_product`. Refresh the store: the mug is there. Place a Cash on Delivery order as a guest.

> The model can only propose writes. A person approves them, and the call runs as the logged-in admin, so it shows up in the audit log under their name.

## 6. Member connects an external MCP client (3:30–5:00)

Window B, **API Keys**: create a key and click Copy. It is shown once.

Load it without displaying it, then start Claude Code with a config that holds only a placeholder:

```powershell
$env:AJAY_KEY = Get-Clipboard; Set-Clipboard -Value " "
'{"mcpServers":{"ajay":{"type":"http","url":"https://ajay.ajayankam.tech/mcp","headers":{"Authorization":"Bearer ${AJAY_KEY}"}}}}' | Set-Content ajay.mcp.json
claude --strict-mcp-config --mcp-config ajay.mcp.json
```

1. `/mcp` shows the server connected with **14 tools**. The admin would see 16.
2. Ask: *"List today's orders and summarise the sales."* Claude calls `woocommerce__list_orders`, then `analytics__summarize_sales`: two servers in one answer.
3. Ask: *"Create a product called Test."* It fails with "requires the admin role".

> The member never saw the store key. Their key works only at the gateway, which calls each server with its own credential. Write tools are hidden from members and rejected if called anyway.

## 7. Revocation and audit (5:00–6:00)

1. Window B, **API Keys**: revoke the key. In Claude Code, run `/mcp` again: the server fails with 401.
2. Window A, **Audit**: the member's calls are listed under their email, including the denied `create_product` and the rejected call after revocation.

> The endpoint is stateless and checks the key on every request, so revocation applies immediately. Every call is recorded, successful or not.

## 8. Isolation and wrap-up (6:00–7:00)

Optional, if time allows:

```bash
kubectl -n ajay-store scale deploy/ajay-mcp-analytics --replicas=0
# Servers page: Analytics turns Unreachable within ~5 s; WooCommerce and Utility keep working
kubectl -n ajay-store scale deploy/ajay-mcp-analytics --replicas=1
```

> A dead server only takes away its own tools. NetworkPolicies mean only the gateway can reach the MCP servers and only WordPress can reach the database.

Close with the trade-offs: SQLite keeps the gateway simple but limits it to one replica; a stateless endpoint gives instant revocation but no `listChanged` push.
