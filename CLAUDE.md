# Project AJAY: guidance for Claude Code

A team MCP gateway in front of a WooCommerce store, deployed with one Helm chart to Kind (local) and k3s (production). Start with [README.md](README.md); architecture is in [docs/system-design.md](docs/system-design.md), security in [docs/threat-model.md](docs/threat-model.md), production operations in [docs/vps-deployment.md](docs/vps-deployment.md).

## Layout

- `apps/gateway`: Express gateway (`/mcp`, `/api`, auth, audit, chat agent, admin CLI). Its image also contains the dashboard.
- `apps/dashboard`: React dashboard.
- `apps/mcp-woocommerce`: WooCommerce MCP server (6 tools).
- `apps/mcp-business`: Utility and Analytics MCP servers (one image).
- `deploy/helm/urumi-platform`: the chart, with `values-local.yaml` and `values-prod.yaml`.
- `deploy/k3s`: cert-manager ClusterIssuers and Traefik configuration for production.
- `.github/workflows/images.yml`: tests, then GHCR images tagged `sha-<commit>`.

## Commands

```bash
npm ci
npm run test --workspace=@project-ajay/gateway
npm run test --workspace=@project-ajay/dashboard
npm run test --workspace=mcp-woocommerce
npm run test --workspace=mcp-business
npm run typecheck --workspace=@project-ajay/gateway
helm lint deploy/helm/urumi-platform -f deploy/helm/urumi-platform/values-local.yaml
```

Production values need an image file from CI (`images-<commit>.yaml`); without one, `helm template` fails on purpose.

## Rules

- **Secrets.** Never print, commit or embed credentials, `.env` files, kubeconfigs or Kubernetes Secret values. Charts reference Secrets by name only. Do not read secret values unless the task requires it.
- **Policy path.** Every tool call goes through `GatewayTools` (`apps/gateway/src/mcp/gateway-tools.ts`). Do not add a route that calls upstreams directly.
- **Evidence.** Do not claim a feature works without a test or a live check. Keep docs consistent with the code.
- **Scope.** Small, focused changes; reuse the existing stack; avoid new dependencies unless they are needed.
- **Approval first** for: Helm upgrades, Kubernetes changes, data writes, Secret changes, firewall or VPS changes, and anything destructive.
- **Never commit** `PROJECT_CONTEXT_PRIVATE.md` (private notes) or `URUMI_ASSIGNMENT.md` (assignment brief). Both may exist locally and are useful context.

## Git

- Branch from `main` as `feat/<topic>`, `fix/<topic>` or `docs/<topic>`; never push to `main`.
- Conventional Commit messages, one line, no AI attribution or `Co-Authored-By` trailers.
- Stage files explicitly (no `git add .`), and review `git diff --cached` for secrets before committing.
- Never force-push, amend published commits or rewrite history.
- Commit or push only when the user asks.
