# Project AJAY — final assignment audit and VPS readiness

- **Audit date:** 2026-10-23
- **Branch:** `feat/kubernetes-deployment` at `43afd24` (in sync with origin)
- **Deadline:** 2026-10-24
- **Scope:** read-only audit; nothing in code, Helm or the cluster was changed.

> Handoff for a fresh session. **Verified** means it was observed live (cluster, Traefik, a real MCP client or the browser) or by an automated test. **Implemented** means the code exists but has not been exercised end to end.

## 1. Git and build state

| Check | Result |
|---|---|
| Working tree | Clean apart from untracked `.claude/`, `CLAUDE.md`, `URUMI_ASSIGNMENT.md`, and this file |
| Dashboard friendly-error fix | Committed and pushed as `43afd24`. **Not deployed**: the live gateway pod still runs the older `ajay-gateway:dev` image |
| Tests | dashboard 5/5, gateway 80/80, mcp-woocommerce 5/5, mcp-business 12/12 (all pass) |
| Typecheck | gateway and dashboard `tsc --noEmit` both clean. A full production build was skipped (host had 0.5 GB free RAM) |
| Tracked secrets scan | No API keys, `ajay_` keys, WooCommerce `ck_`/`cs_` keys or private keys in tracked files. `.env` and `PROJECT_CONTEXT_PRIVATE.md` are gitignored. The only tracked secret-like files are `.env.example` (placeholders) and `templates/mcp-business-secret.yaml` (generated via `randAlphaNum` / `lookup`) |
| Safe to commit | `docs/vps-readiness-audit.md` (this file); `CLAUDE.md` and `.claude/skills`, `.claude/agents` after review. `URUMI_ASSIGNMENT.md` is the owner's call (it is hiring text). **Never** commit `PROJECT_CONTEXT_PRIVATE.md`, `.env` or anything from the backups |

## 2. Requirement matrix (from `URUMI_ASSIGNMENT.md`)

Severity: **P0** blocks submission, **P1** is graded or visible, **P2** is nice to have.

### Kubernetes and Helm
| Requirement | Implementation | Evidence | Status | Sev / action |
|---|---|---|---|---|
| Local K8s | Kind `ajay`, namespace `ajay-store`, Helm release `ajay` rev 10 | `helm list`; all pods Running | **Verified** | — |
| Deployable to VPS with same charts | `values-prod.yaml` (k3s, local-path, GHCR, TLS) | lint and template only | **Partial**: never deployed; image tags not pushed | P1: deploy, or at least `helm template -f values-prod.yaml` evidence |
| Helm only; local/prod values | `values-local.yaml`, `values-prod.yaml` | files | **Verified** | — |
| Everything in cluster | store, MariaDB, Woo MCP, utility, analytics, gateway+dashboard (one image, `DASHBOARD_DIR`) | pods | **Verified** | Explain "dashboard is served by the gateway pod" in the docs |
| Persistent DB and WP content | PVCs `mariadb-data-ajay-mariadb-0`, `ajay-wordpress-data`, `ajay-gateway-data` | `kubectl get pvc` Bound; data survived many restarts | **Verified** | — |
| Ingress with stable URLs; local domain documented | Traefik; `ajay.localtest.me:8080`, `store.localtest.me:8080` | `templates/ingress.yaml`, live port-forward | **Verified**; documented only in the runbook | P0: put it in the README |
| Probes, requests and limits on every workload | All chart workloads have them | `values.yaml`, templates | **Partial**: the legacy `ajay-https-proxy` (not in the chart) has none, and the MCP pods use the default 1 s probe timeout | P1: retire the proxy before recording, or explain it; P2: probe `timeoutSeconds: 3` |
| No hardcoded secrets; Secrets used | `secretKeyRef` everywhere; existing Secrets are external | scan above | **Verified** | P1: document `kubectl create secret` commands (names only) |

### WooCommerce MCP server
| Requirement | Implementation | Evidence | Status | Sev / action |
|---|---|---|---|---|
| Self-written, Streamable HTTP | `apps/mcp-woocommerce` (TypeScript SDK, bearer token) | 5 tests; live via gateway | **Verified** | — |
| list/create products, list/get orders, update order status | 6 tools (+`get_product`) | live list calls; chat created product #23 | **Verified** except `update_order_status` live | P2: optional live call on the demo order |
| Not reachable from outside; only the gateway calls it | ClusterIP + bearer + NetworkPolicy `ajay-mcp-woocommerce` (in from gateway only) | negative tests from other pods blocked (P0-6) | **Verified** | — |
| Document the store access method | WC REST v3 over in-cluster HTTP with `X-Forwarded-Proto: https` | code comments only | **Missing (docs)** | P0: system design note |

### Gateway
| Requirement | Implementation | Evidence | Status | Sev / action |
|---|---|---|---|---|
| Add/edit/disable/remove servers with an optional credential | admin API and Servers pages | API tests; UI disable/enable verified in C0 | **Verified** (remove: API test only) | — |
| One MCP endpoint, aggregated listing, routing | stateless `POST /mcp` | Inspector CLI via Traefik: admin 16 tools, member 14 | **Verified** | — |
| Name collision scheme documented | `<slug>__<tool>` | `mcp/tool-names.ts`, tests | Code **verified**; docs **missing** | P0: design note |
| Slow/dead upstream isolated; timeouts; clear error | `allSettled`, 10 s upstream timeout, Woo 8 s store timeout | tests; Utility disabled live → WooCommerce still works | **Partial live**: pod-kill (scale analytics to 0) not yet run | P0: run during the demo |
| Upstream credentials server-side | `toPublicServer`, write-only secrets | tests | **Verified** | — |
| ≥3 upstreams | woocommerce, utility, analytics (6/5/5) | Checkpoint 1 PASS | **Verified** | — |

### Team and access
| Requirement | Implementation | Evidence | Status | Sev / action |
|---|---|---|---|---|
| admin and member roles | last-admin guard, `adminOnlyTools` | tests; member sees 14 tools, `create_product` denied | **Verified** | — |
| Per-user hashed, revocable keys | SHA-256, `ajay_` prefix | 401 `API_KEY_REVOKED` observed live | **Verified** (CLI revoke; UI revoke not yet) | P0: in the demo |
| Audit log with user, server, tool, time, duration, outcome; visible in dashboard | `writeAudit` on the single dispatch path | tests; live rows by user | **Verified**. No per-key column (deferred) | — |
| Invite members | one-time invite link (no email) | C0-16/17 earlier | **Verified** locally | — |

### Chat agent
| Requirement | Implementation | Evidence | Status | Sev / action |
|---|---|---|---|---|
| LLM tool loop through the gateway, shows tools | Gemini primary, Groq fallback; tool chips; write approval card | chat created product #23 "Urumi Demo Mug" ₹299 | **Verified** (create) | — |
| Acts as the logged-in user | `GatewayTools.callTool(user, …, "chat")` | audit rows under the admin | **Verified** | — |
| LLM keys as Secrets | `ajay-gateway-llm`-style Secret refs, optional | template | **Verified** | — |

### Definition of done (two users)
| Step | Status |
|---|---|
| Storefront COD checkout; order visible in WC admin | **Not yet run** in the current Traefik setup (historical order #16 via the old proxy) |
| A: chat creates product, it appears on the storefront | Product #23 created ✅; storefront visibility **to confirm** |
| A: order the product by hand, chat "orders today" returns it | **Not yet run** |
| B: external client with URL + key, all tools, orders question | Inspector CLI verified (14 tools, read calls). **Claude Code not yet run** |
| B: one prompt using two upstreams | Inspector: separate calls verified; single LLM prompt via Claude Code **not yet run** |
| Revoke B's key → rejected | Verified via CLI; **UI flow not yet run** |
| Disable upstream → tools gone from chat and client | Client verified (14→9); **chat side to show** |
| Kill an upstream pod → others work; dashboard shows Unreachable | **Not yet run** live (fake-upstream tests only) |
| Every call audited to the right user | Verified for calls run so far |

### Deliverables
| Item | Status | Sev |
|---|---|---|
| `README.md` (local, VPS, order, MCP client, chat) | Written 2026-10-23 (Checkpoint 2) | — |
| System design and trade-offs note | Written: [system-design.md](system-design.md) | — |
| Threat model note (4 required questions) | Written: [threat-model.md](threat-model.md) | — |
| Stand-out list | In the README | — |
| Helm charts and values (local and prod) | Present | — |
| Demo video (6 sections) and form submission | **Not started** | **P0** |

## 3. Completion estimate

Method: the mandatory requirement rows above, weighted by area. Code and tests are 30%, live/DoD evidence 30%, deliverables (docs and video) 30%, VPS deployment 10%.

| Area | Done |
|---|---|
| Code and tests (all mandatory features implemented and tested) | ~95% |
| Live DoD evidence | ~55% (about 5 of 9 steps observed) |
| Docs and video | ~10% (runbook only) |
| VPS (deployable; same charts) | ~25% (prod values only) |
| **Weighted total** | **≈ 60%**. The code is essentially done; the **remaining risk is docs, the live demo and the video**, not engineering |

## 4. Critical blockers (ordered)
1. **Host memory.** The Windows host has 7.7 GB RAM with about 0.5 GB free. The Kind node stalls, causing probe timeouts, 502/503 errors and restarts (analytics 24, utility 19, proxy 18 restarts). This threatens the recording. Before recording:
   - close browsers and IDEs
   - optionally `wsl --shutdown` and restart Docker for a clean start (needs owner approval; the data is on PVs)
   - or record on the VPS instead
2. README, design note and threat model are missing (P0 deliverables).
3. The demo video is not recorded.
4. The remaining DoD steps (COD order, chat "orders today", Claude Code as member B, UI revoke, pod kill) are not yet run.
5. The dashboard fix is not deployed. It needs a gateway image rebuild, `kind load` and a Helm/rollout approval. Optional: if login works on the first try, the old message is acceptable.

## 5. Gemini / Groq reliability

| Concern | Current behaviour (`apps/gateway/src/chat/*`) | Risk | Recommendation |
|---|---|---|---|
| Provider fallback | Chain is `LLM_PROVIDERS` × models (Gemini `gemini-3.6-flash`, `gemini-3.5-flash-lite`, then Groq `gpt-oss-120b`, `gpt-oss-20b`); any failure moves to the next entry; a turn stays on its fallback | Low | — |
| Rate limit / quota | 429 classified as `rate_limit` (`errors.ts`) and falls through the chain. **No retry or backoff** within a provider; no `Retry-After` handling | Medium: four free-tier entries usually absorb it | P2: one jittered retry on 429/503 before falling back |
| Tool-calling compatibility | Native Gemini API (thought signatures kept in `native`); Groq OpenAI-format. Mid-turn switch is supported | Low (unit-tested) | Rehearse once with Gemini disabled to prove the Groq path live |
| Timeouts | `LLM_TIMEOUT_MS` 60 s per call; up to `CHAT_MAX_TOOL_ROUNDS` 8 rounds | The dashboard chat request allows 180 s (`queries.ts:208`), and Traefik has no default read timeout. A worst-case turn (several fallbacks × 8 rounds × 60 s) can still exceed 180 s and shows as a client timeout while the server keeps running | Low for the demo. P2: a server-side overall turn deadline below 180 s |
| Token budget / history | History trimmed to 80 messages at a user boundary; tool results truncated at 12 000 chars; Groq `max_completion_tokens` 2048 | Groq free TPM (~8K) can be exceeded by large `list_products` output plus 16 tool schemas | Keep demo prompts narrow ("today's orders", `per_page` small); start a new conversation per demo segment |
| Concurrency | No per-user or global chat concurrency limit; no rate limit on `/api/chat` | **High for a public demo:** any logged-in user can burn the shared free quota | P1 for VPS: per-user chat rate limit (e.g. 10/min) and a global in-flight cap; only invited users can log in, which already limits exposure |
| Timed-out writes | Writes need an approval card; `takePendingAction` is atomic (no double execution); identical calls in a turn are deduplicated; the prompt forbids repeating a succeeded write. A Woo 8 s / gateway 10 s timeout returns an error **although the product may have been created** | Medium: a user re-asking could create a duplicate | P2: on a write timeout, tell the model "outcome unknown, verify with a list call before retrying"; demo tip: check the store before re-asking |
| User-facing failure | All providers failed → 503 `LLM_UNAVAILABLE` with the failures and the tool calls already executed; the message is kept | Low | — |
| Keys | Only provider and model names are exposed (`/api/chat/status`); `org_` ids are redacted in errors | Low | — |

## 6. KVM 2 feasibility (2 vCPU, 8 GB, 100 GB NVMe)

Chart totals (6 workloads): **requests 450m CPU / 960 Mi**, **limits 2.75 CPU / ~2.9 Gi**.

| Component | Estimated steady RAM |
|---|---|
| k3s server (with embedded SQLite datastore) and Traefik, CoreDNS, local-path, metrics-server | ~0.8–1.0 GB |
| cert-manager (3 pods) | ~0.15 GB |
| MariaDB 11.4 | ~0.25–0.4 GB |
| WordPress Apache/PHP | ~0.2–0.5 GB (spikes under the admin and checkout) |
| Gateway, Woo MCP and 2 business servers (Node, ~280 MB amd64 images) | ~0.4 GB |
| **Total** | **~2–2.5 GB typical, < 4.5 GB at limits**, which fits in 8 GB |

- **CPU risk:** WordPress first install and WooCommerce activation (bootstrap) and image pulls briefly saturate 2 vCPU. Steady demo load is low. The limits sum (2.75) exceeds 2 vCPU, which is fine because they are burst caps, not reservations.
- **Images:** amd64, about 280 MB each; Hostinger KVM is x86_64, so no multi-arch is needed. Build off the VPS and push to GHCR; **pushes are not yet done/verified**.

**Minimal adjustments (proposed, not applied):**
- `values-prod.yaml`:
  - `wordpress.resources.limits.cpu: 1000m`
  - startup probe `failureThreshold` stays at 30
- MCP pods: add `timeoutSeconds: 3` to the readiness and liveness probes (the default of 1 s is the main restart cause under load)
- Add a 2 GB swapfile on the VPS as a safety net (k3s tolerates it with `--kubelet-arg=fail-swap-on=false`, or keep swap off and rely on 8 GB headroom; prefer no swap)

**Verdict: KVM 2 is sufficient** for this single-store demo with headroom. KVM 1 (4 GB) would be tight.

## 7. VPS readiness

| Item | State | Next step |
|---|---|---|
| Production values | `values-prod.yaml` with placeholder hosts `ajay.example.com` / `store.example.com`, a placeholder ClusterIssuer email, and assumed image tags | Fill in the real domain (or `*.<ip>.sslip.io`) and tags |
| GHCR images | Not pushed; packages must be public, or use an `imagePullSecret` | `docker build` → `docker tag` → `docker push ghcr.io/ajay-ankam/…`; verify anonymous pull |
| Secrets injection | Chart references existing Secrets by name; no creation runbook | Write `docs/secrets.md` with `kubectl create secret generic … --from-literal`, using placeholder names only |
| TLS / Ingress | Templates support cert-manager `letsencrypt-prod`; `deploy/k3s/traefik-config.yaml` adds the HTTP→HTTPS redirect | Install cert-manager; apply the issuer; DNS A records first (HTTP-01 needs port 80 open) |
| HSTS | Not set | P2: a Traefik middleware |
| NetworkPolicies | Enforced on Kind; k3s enforces them via its embedded kube-router. Prod defaults to the Traefik pods in `kube-system` | Verify the k3s Traefik label `app.kubernetes.io/name=traefik`; rerun one negative test |
| WordPress/WooCommerce bootstrap | **Missing**: no WP-CLI Job. A fresh VPS store needs install, WooCommerce, INR, COD, a REST key and the `ajay-woocommerce-api` Secret | Simplest for the deadline: a manual `kubectl exec` + `wp` runbook, then create the REST key in WC admin and the Secret. A hook Job is optional |
| SQLite / MariaDB persistence | PVCs on `local-path` (node disk) | Back up: `mariadb-dump` and `sqlite3 .backup` / `VACUUM INTO` via `kubectl exec`, copied off the box |
| Public callback / invite URLs | Invite links derive from the request host (verify with `trust proxy` behind Traefik + TLS) | Test one invite link over HTTPS |
| SMTP | None (manual link); egress allows only 443 | Keep the manual link for the deadline |
| External MCP over HTTPS | `https://ajay.<domain>/mcp` with a bearer key; no `WWW-Authenticate` header | Test Claude Code remotely |
| Restart recovery | Proven repeatedly on Kind | `sudo reboot` test on the VPS |
| Deploy / rollback | Helm only | `helm upgrade --install ajay deploy/helm/urumi-platform -n ajay-store --create-namespace -f values-prod.yaml`; rollback with `helm rollback ajay <prev>` (show it in the video) |
| Firewall | — | ufw: 22, 80, 443 only; never expose 6443 |

## 8. Ranked optional improvements (not implemented)

| # | Improvement | Reviewer value | Effort | Deploy risk | Recommend |
|---|---|---|---|---|---|
| 1 | Docs: README, design, threat model, stand-out list | **Mandatory** | 3 h | none | **Do first** |
| 2 | Retire `ajay-https-proxy` (scale to 0, keep the manifest backup) | Removes the only non-compliant workload | 10 min | low (direct path proven) | Do, with approval |
| 3 | MCP probe `timeoutSeconds: 3` | Fewer restarts on screen | 15 min + rollout | low | Do with the next Helm upgrade |
| 4 | Per-user chat rate limit and concurrency cap | Protects free LLM quota on a public VPS | 1 h | low | Do if deploying publicly |
| 5 | Write-timeout "outcome unknown" hint | Prevents duplicate products | 30 min | low | Optional |
| 6 | `WWW-Authenticate: Bearer` on `/mcp` 401 | Cleaner client behaviour after revocation | 15 min | low | Optional |
| 7 | 429 retry with jittered backoff | Fewer fallbacks | 45 min | low | Optional |
| 8 | Deploy the dashboard friendly-error image | Nicer login failures | 20 min + rollout | low | Bundle with #3 |
| 9 | HSTS middleware | Security polish | 15 min | low | VPS only |
| 10 | Gmail SMTP invites | Low (a manual link satisfies the requirement); adds an egress rule and a Secret | 2 h | medium | **Skip** |
| 11 | Per-key audit column | Low | 1 h + migration | medium | Skip |

## 9. Prioritised execution plan
1. **Now (local, no infrastructure change):** write the README, `docs/system-design.md` and `docs/threat-model.md`, plus the stand-out list.
2. **With approval:** one Helm upgrade bundling the probe timeouts and the new gateway image (dashboard fix); scale `ajay-https-proxy` to 0.
3. **Free host RAM**, then run the remaining DoD steps interactively:
   1. COD order
   2. chat "orders today"
   3. member invite and key, then Claude Code (14 tools, two-upstream prompt)
   4. UI revoke
   5. disable Utility (chat and client)
   6. scale analytics to 0 and back
   7. audit view
4. **Record the video** locally if the VPS is not ready by the afternoon of Oct 23.
5. **VPS (if time):** k3s → GHCR push → cert-manager → Secrets → Helm install → WP bootstrap → HTTPS smoke test → reboot test → `helm upgrade` / `helm rollback` demo.
6. Final README check, then submit the form on Oct 24 with at least 3 h of buffer.

Do not create a new product (#23 "Urumi Demo Mug" exists), and do not reset any data.
