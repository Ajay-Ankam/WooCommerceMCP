# Production deployment runbook (k3s on a Hostinger VPS)

How to deploy Project AJAY from a commit on `main` to a fresh single-node k3s server, using the same Helm chart as local development.

| | |
|---|---|
| Dashboard and MCP endpoint | https://ajay.ajayankam.tech, https://ajay.ajayankam.tech/mcp |
| Storefront | https://store.ajayankam.tech |
| Server | Ubuntu 24.04 x86_64, 2 vCPU, 8 GB RAM |
| Namespace / Helm release | `ajay-store` / `ajay` |
| Chart | [deploy/helm/urumi-platform](../deploy/helm/urumi-platform) with [values-prod.yaml](../deploy/helm/urumi-platform/values-prod.yaml) |
| Status | Deployed 2026-10-24 (k3s v1.37.1+k3s1, Helm v4.3.1, cert-manager v1.21.3, release revision 3) |

> **Open security item.** Ports **6443** (Kubernetes API) and **10250** (kubelet) were reachable from the internet when last checked. Both require authentication, but neither should be public. Restrict the Hostinger firewall to 22, 80 and 443 (§3.2) and re-check from outside the server. The restriction has **not** been verified yet.

**Rules**

- Deploy only a commit on `main`, with the images CI built from that commit (pinned by digest). No local builds, no moving tags.
- The repository holds Secret names, never values. Credentials are created on the server and go straight into Kubernetes Secrets, never into files, shell history or command arguments.
- Commands run on the server as root (`sudo -i`) with `export KUBECONFIG=/etc/rancher/k3s/k3s.yaml`. Steps marked **owner only** handle credentials.

## 1. Deployment order

Three constraints set the order:

- The WooCommerce MCP server **requires** the `ajay-woocommerce-api` Secret to start, and that key can only be created after WooCommerce is installed.
- A fresh WordPress shows its install wizard to the first visitor, so the store must be installed before any Ingress exists.
- Let's Encrypt validates through the Ingress on port 80, and failed production attempts count against rate limits.

| Step | What happens | Public routes |
|---|---|---|
| Server preparation (§3) | SSH, firewall, DNS, k3s, cert-manager, ClusterIssuers | none |
| Secrets (§5) | MariaDB, MCP token, gateway | none |
| **Phase A** (§6) | Release without Ingress and without the WooCommerce MCP server | none |
| Store bootstrap (§7) | WordPress + WooCommerce via WP-CLI; REST key generated into its Secret | none |
| **Phase B** (§8) | Full release, Let's Encrypt **staging** certificates | HTTPS only |
| **Phase C** (§9) | Production certificates, then the HTTP→HTTPS redirect | HTTPS; HTTP redirects |
| Verification (§10) | Functional, security and isolation checks | |

## 2. Images

[.github/workflows/images.yml](../.github/workflows/images.yml) runs on pushes to `main` that touch `apps/`, `packages/`, the lockfiles, `.dockerignore` or the workflow, and on manual dispatch from `main`. It runs typechecks and tests, then builds and pushes three `linux/amd64` images with the run's `GITHUB_TOKEN`:

| Image | Tag |
|---|---|
| `ghcr.io/ajay-ankam/ajay-gateway` | `sha-<40-hex commit>` |
| `ghcr.io/ajay-ankam/ajay-mcp-business` | `sha-<40-hex commit>` |
| `ghcr.io/ajay-ankam/ajay-mcp-woocommerce` | `sha-<40-hex commit>` |

Each image carries the `org.opencontainers.image.revision` label. The job summary and the `helm-images-<commit>` artifact contain `images-<commit>.yaml`, a Helm values file with each image's repository, tag and digest. `values-prod.yaml` leaves the application tags empty, so `helm` fails with `…image.tag is required` until that file is passed.

**One-time:** after the first run, set each of the three GHCR packages to **Public** (Package settings). The chart has no image pull secret.

Check that a commit's images are anonymously pullable and match the artifact (prints digests only):

```bash
SHA=<40-hex commit>
for i in ajay-gateway ajay-mcp-business ajay-mcp-woocommerce; do
  t=$(curl -fsS "https://ghcr.io/token?scope=repository:ajay-ankam/$i:pull" | sed -E 's/.*"token":"([^"]+)".*/\1/')
  printf '%s ' "$i"
  curl -fsSI -H "Authorization: Bearer $t" \
    -H "Accept: application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json" \
    "https://ghcr.io/v2/ajay-ankam/$i/manifests/sha-$SHA" | grep -i '^docker-content-digest'
done
```

## 3. Server preparation

### 3.1 SSH and base system

- Log in with an SSH key. Under `/etc/ssh/sshd_config.d/` set `PasswordAuthentication no` and `PermitRootLogin prohibit-password`, then `systemctl reload ssh`. Keep the current session open until a new login works.
- `apt update && apt full-upgrade -y`; enable `unattended-upgrades`; `apt install -y gettext-base` if `envsubst` is missing.
- Clone the repository:
  ```bash
  git clone https://github.com/Ajay-Ankam/WooCommerceMCP.git /opt/ajay
  mkdir -p /root/ajay/backups && chmod 700 /root/ajay /root/ajay/backups
  ```

### 3.2 Firewall

Only TCP 22, 80 and 443 may be reachable from the internet. Port 80 stays open after the redirect, because certificate renewals use it.

- **Hostinger firewall (hPanel):** allow 22, 80, 443; drop everything else; click **Synchronise** after every change.
- **ufw (optional second layer):** it was **not** enabled on the production server. If you enable it, allow the k3s pod and service networks too, and test SSH and all workloads straight after:
  ```bash
  ufw default deny incoming && ufw default allow outgoing
  ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp
  ufw allow from 10.42.0.0/16 && ufw allow from 10.43.0.0/16
  ufw enable
  ```

Check from **another machine**. A check run on the server itself bypasses the Hostinger firewall.

```bash
for p in 22 80 443 6443 10250; do nc -z -w 3 201.18.198.141 $p && echo "$p open" || echo "$p closed"; done
```

Expected: 22, 80 and 443 open; 6443 and 10250 closed.

### 3.3 DNS

A records `ajay.ajayankam.tech` and `store.ajayankam.tech` point at the server's IPv4 address. Do not add AAAA records unless IPv6 is open and tested: Let's Encrypt prefers IPv6.

```bash
dig +short A ajay.ajayankam.tech; dig +short A store.ajayankam.tech
dig +short AAAA ajay.ajayankam.tech store.ajayankam.tech   # must be empty
```

### 3.4 k3s

Pin a stable version from https://github.com/k3s-io/k3s/releases. Copy the Traefik configuration first. It only sets `externalTrafficPolicy: Local`, which keeps real client IPs for the login throttle. The redirect is added in Phase C.

```bash
mkdir -p /var/lib/rancher/k3s/server/manifests
cp /opt/ajay/deploy/k3s/traefik-config.yaml /var/lib/rancher/k3s/server/manifests/
curl -sfL https://get.k3s.io | INSTALL_K3S_VERSION=<v1.xx.y+k3s1> sh -s - \
  --secrets-encryption --write-kubeconfig-mode 600
echo 'export KUBECONFIG=/etc/rancher/k3s/k3s.yaml' >> /root/.bashrc && export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
```

`--secrets-encryption` encrypts Secrets at rest. The kubeconfig is cluster-admin, readable by root only, and never leaves the server.

```bash
kubectl get nodes                       # Ready
kubectl get storageclass,ingressclass   # local-path (default), traefik
kubectl -n kube-system get pods -l app.kubernetes.io/name=traefik   # Running; label used by the NetworkPolicies
```

k3s enforces NetworkPolicies with its built-in controller.

### 3.5 Helm, cert-manager and ClusterIssuers

Install Helm from https://helm.sh/docs/intro/install/, then cert-manager with a pinned version:

```bash
helm repo add jetstack https://charts.jetstack.io && helm repo update
helm install cert-manager jetstack/cert-manager -n cert-manager --create-namespace \
  --version <vX.Y.Z> --set crds.enabled=true --wait
```

The ClusterIssuers use HTTP-01 through Traefik. The contact email is substituted at apply time and never committed:

```bash
cd /opt/ajay
export ACME_EMAIL=<contact email>
envsubst '$ACME_EMAIL' < deploy/k3s/cluster-issuer-staging.yaml | kubectl apply -f -
envsubst '$ACME_EMAIL' < deploy/k3s/cluster-issuer.yaml | kubectl apply -f -
kubectl get clusterissuer               # letsencrypt-staging, letsencrypt-prod: READY True
```

cert-manager's temporary solver pods run in `ajay-store`. The chart's NetworkPolicies select only release pods (`app.kubernetes.io/instance=ajay`), so they don't block the solvers.

## 4. Release inputs

Pin the checkout to the commit CI built, and place the inputs that stay on the server:

```bash
cd /opt/ajay && SHA=<40-hex commit>
git fetch origin main && git merge-base --is-ancestor "$SHA" origin/main && git checkout --detach "$SHA"
# Copy images-$SHA.yaml from the workflow artifact or job summary to /root/ajay/
printf 'gateway:\n  bootstrapAdminEmail: %s\n' '<first admin email>' > /root/ajay/site.yaml

CHART=/opt/ajay/deploy/helm/urumi-platform
VALUES=(-f "$CHART/values-prod.yaml" -f /root/ajay/site.yaml -f /root/ajay/images-$SHA.yaml)
```

`CHART` and `VALUES` are used by every install and upgrade below.

## 5. Namespace and Secrets (owner only)

| Secret | Keys | Read by |
|---|---|---|
| `ajay-mariadb-auth` | `root-password`, `user-password` | MariaDB, WordPress |
| `ajay-mcp-auth` | `token` | WooCommerce MCP (inbound), gateway (outbound) |
| `ajay-gateway` | `BOOTSTRAP_ADMIN_PASSWORD`, `GEMINI_API_KEY`, `GROQ_API_KEY` (all optional) | gateway |
| `ajay-woocommerce-api` | `consumer-key`, `consumer-secret` | WooCommerce MCP (created in §7) |
| `ajay-mcp-business-auth` | `utility-token`, `analytics-token` | generated by the chart; kept across upgrades |

Values are written to a RAM-backed file that only root can read, loaded, then shredded. Generated values are never displayed. Typed values use `read -s`, which does not echo.

```bash
kubectl create namespace ajay-store
umask 077; f=$(mktemp -p /dev/shm)

printf 'root-password=%s\nuser-password=%s\n' "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" > "$f"
kubectl -n ajay-store create secret generic ajay-mariadb-auth --from-env-file="$f"
printf 'token=%s\n' "$(openssl rand -hex 32)" > "$f"
kubectl -n ajay-store create secret generic ajay-mcp-auth --from-env-file="$f"

: > "$f"
read -rsp 'Bootstrap admin password (min 10 chars): ' p; echo; printf 'BOOTSTRAP_ADMIN_PASSWORD=%s\n' "$p" >> "$f"
read -rsp 'Gemini API key (blank to skip): ' p; echo; [ -n "$p" ] && printf 'GEMINI_API_KEY=%s\n' "$p" >> "$f"
read -rsp 'Groq API key (blank to skip): ' p; echo; [ -n "$p" ] && printf 'GROQ_API_KEY=%s\n' "$p" >> "$f"
unset p
kubectl -n ajay-store create secret generic ajay-gateway --from-env-file="$f"
shred -u "$f"
kubectl -n ajay-store get secrets       # names only
```

Use new values in production; never reuse development ones.

## 6. Phase A: private install

```bash
helm upgrade --install ajay "$CHART" -n ajay-store "${VALUES[@]}" \
  --set ingress.enabled=false --set mcpWoocommerce.enabled=false \
  --wait --timeout 15m
kubectl -n ajay-store get pods,pvc,ingress
kubectl -n ajay-store get pods -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.containers[0].image}{"\n"}{end}'
```

Expected: gateway, MariaDB, WordPress, Utility and Analytics Ready; PVCs `ajay-gateway-data`, `ajay-wordpress-data` and `mariadb-data-ajay-mariadb-0` Bound; no Ingress; every application image shown as `…:sha-<commit>@sha256:…`. The gateway lists WooCommerce as Unreachable until Phase B.

## 7. Store bootstrap (still no public route)

WP-CLI runs inside the WordPress pod as `www-data`, through `kubectl exec`. Download it and verify its checksum. The script goes in on stdin, which avoids nested quoting:

```bash
WP=$(kubectl -n ajay-store get pod -l app.kubernetes.io/name=wordpress -o jsonpath='{.items[0].metadata.name}')
kubectl -n ajay-store exec -i "$WP" -- sh -s <<'EOF'
set -e
V=2.12.0   # current release: https://github.com/wp-cli/wp-cli/releases
B=https://github.com/wp-cli/wp-cli/releases/download/v$V
curl -fsSLo /tmp/wp-cli.phar "$B/wp-cli-$V.phar"
echo "$(curl -fsSL "$B/wp-cli-$V.phar.sha512" | cut -d' ' -f1)  /tmp/wp-cli.phar" | sha512sum -c -
EOF
wp() { kubectl -n ajay-store exec -i "$WP" -- runuser -u www-data -- \
  php -d memory_limit=512M /tmp/wp-cli.phar --path=/var/www/html "$@"; }
```

`/tmp` is not on the volume; repeat the download if the pod restarts.

**Install WordPress (owner only).** The password goes to WP-CLI on stdin (`--prompt`), never as an argument:

```bash
wp core is-installed || {
  read -rsp 'WordPress admin password: ' p; echo
  printf '%s\n' "$p" | wp core install --url=https://store.ajayankam.tech --title="Ajay Store" \
    --admin_user=<login> --admin_email=<email> --skip-email --prompt=admin_password >/dev/null
  unset p
}
```

**WooCommerce, INR, Cash on Delivery** (safe to re-run):

```bash
wp plugin is-installed woocommerce || wp plugin install woocommerce
wp plugin activate woocommerce
wp rewrite structure '/%postname%/'
wp option update woocommerce_currency INR
wp option update woocommerce_coming_soon no
wp option update woocommerce_cod_settings '{"enabled":"yes","title":"Cash on delivery","description":"Pay with cash upon delivery.","instructions":"Pay with cash upon delivery."}' --format=json
wp wc tool run install_pages --user=1
```

A `sendmail: not found` warning is expected: the WordPress image has no mail transport, so the store sends no emails.

**REST key → Secret (owner only, run once).** The key pair is generated inside the pod the way WooCommerce's key screen does it, written to a RAM file and loaded into the Secret. It is never displayed. It needs `read_write`, because the admin-only tools create products and update orders.

```bash
umask 077; f=$(mktemp -p /dev/shm)
wp eval-file - > "$f" <<'PHP'
<?php
global $wpdb;
$user = get_user_by( 'id', 1 );
if ( ! $user || ! user_can( $user, 'manage_woocommerce' ) ) { fwrite( STDERR, "user 1 cannot manage WooCommerce\n" ); exit( 1 ); }
$ck = 'ck_' . wc_rand_hash();
$cs = 'cs_' . wc_rand_hash();
$ok = $wpdb->insert( $wpdb->prefix . 'woocommerce_api_keys', array(
  'user_id' => $user->ID, 'description' => 'ajay-mcp-woocommerce', 'permissions' => 'read_write',
  'consumer_key' => wc_api_hash( $ck ), 'consumer_secret' => $cs, 'truncated_key' => substr( $ck, -7 ),
) );
if ( ! $ok ) { fwrite( STDERR, "insert failed\n" ); exit( 1 ); }
echo "consumer-key=$ck\nconsumer-secret=$cs\n";
PHP
[ "$(grep -cE '^consumer-(key=ck|secret=cs)_[0-9a-f]{40}$' "$f")" = 2 ] \
  && kubectl -n ajay-store create secret generic ajay-woocommerce-api --from-env-file="$f" \
  || echo "key generation failed; nothing created"
shred -u "$f"
```

To rotate the key, revoke it under *WooCommerce → Settings → Advanced → REST API*, delete the Secret, re-run this step, then restart `deploy/ajay-mcp-woocommerce`.

## 8. Phase B: staging certificates

```bash
helm upgrade ajay "$CHART" -n ajay-store "${VALUES[@]}" \
  --set ingress.tls.clusterIssuer=letsencrypt-staging --wait --timeout 10m
kubectl -n ajay-store get pods,ingress,certificate   # all Ready; certificates READY True within a few minutes
```

Staging certificates are untrusted, so `-k` is used here only:

```bash
curl -sk -o /dev/null -w '%{http_code}\n' https://ajay.ajayankam.tech/health           # 200
curl -sk -o /dev/null -w '%{http_code}\n' https://store.ajayankam.tech/                # 200
curl -sk -o /dev/null -w '%{http_code}\n' -X POST https://ajay.ajayankam.tech/mcp      # 401
echo | openssl s_client -connect store.ajayankam.tech:443 -servername store.ajayankam.tech 2>/dev/null \
  | openssl x509 -noout -issuer                                                        # (STAGING) issuer
```

Port 80 returns 404 at this point: the Ingresses use the HTTPS entrypoint only.

## 9. Phase C: production certificates and redirect

Without the staging override, the chart uses `letsencrypt-prod`, and cert-manager re-issues both certificates:

```bash
helm upgrade ajay "$CHART" -n ajay-store "${VALUES[@]}" --wait --timeout 10m
kubectl -n ajay-store get certificate                # READY True
for h in ajay store; do
  echo | openssl s_client -connect $h.ajayankam.tech:443 -servername $h.ajayankam.tech -verify_return_error 2>/dev/null \
    | grep 'Verify return code'                      # 0 (ok)
done
```

Only after both production certificates are valid, enable the redirect. It replaces the same HelmChartConfig:

```bash
cp /opt/ajay/deploy/k3s/traefik-config-redirect.yaml /var/lib/rancher/k3s/server/manifests/traefik-config.yaml
kubectl -n kube-system rollout status deploy/traefik
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://store.ajayankam.tech/   # 301 https://store.ajayankam.tech/
```

The redirect targets port `:443`. Targeting the `websecure` entrypoint name would redirect to Traefik's internal port 8443. If `kubectl -n kube-system get helmchart traefik -o yaml` shows existing `additionalArguments`, merge them into the file first.

## 10. Verification

| Check | How | Verified 2026-10-24 |
|---|---|---|
| Workloads healthy | `kubectl -n ajay-store get deploy,sts,pvc,ingress,certificate`; no restarts | Yes |
| Trusted TLS, HTTP redirect | §9 commands | Yes |
| MCP authentication | `POST /mcp` without a key, or with a revoked key → 401 | Yes |
| Tool discovery and calls | Member key: 14 tools; `woocommerce__list_products` returns store data | Yes (curl) |
| Role enforcement | Member calls `woocommerce__create_product` → "requires the admin role" | Yes |
| Audit | Every call above appears under the calling user | Yes |
| NetworkPolicy isolation | Negative test below | Yes |
| Dashboard, chat, external client | Admin login; Servers shows 3 Connected; chat creates a product; Claude Code connects with a member key | Not yet in production |
| Storefront order | Cash on Delivery checkout appears in WooCommerce and via `list_orders` | Not yet in production |

After the first admin login, remove the bootstrap password. It is only read on an empty database.

```bash
kubectl -n ajay-store patch secret ajay-gateway --type=json -p='[{"op":"remove","path":"/data/BOOTSTRAP_ADMIN_PASSWORD"}]'
```

MCP client test without writing the key to disk. The config holds only a placeholder, which Claude Code expands from the environment at runtime:

```bash
export AJAY_KEY=<member key, pasted from the dashboard>   # or read -rs AJAY_KEY
cat > ajay.mcp.json <<'EOF'
{"mcpServers":{"ajay":{"type":"http","url":"https://ajay.ajayankam.tech/mcp","headers":{"Authorization":"Bearer ${AJAY_KEY}"}}}}
EOF
claude --strict-mcp-config --mcp-config ajay.mcp.json
```

NetworkPolicy negative test. It uses a throwaway pod outside the release, removed on exit. `-i` reads stdin, so run it on its own, not inside a heredoc:

```bash
kubectl -n ajay-store run np-test --rm -i --restart=Never --image=curlimages/curl:8.11.1 -- sh -c \
  'curl -m 5 -s -o /dev/null http://ajay-mcp-woocommerce:3001/health; echo "woo exit=$?";
   nc -z -w 5 ajay-mariadb 3306; echo "mariadb exit=$?";
   curl -m 8 -s -o /dev/null -w "internet %{http_code}\n" https://example.org'
```

Expected: `woo exit=7` and `mariadb exit=1` (refused by policy), `internet 200`.

## 11. Persistence, backup and restore

| Data | PVC | Protection |
|---|---|---|
| WordPress files, plugins, uploads | `ajay-wordpress-data` | `helm.sh/resource-policy: keep` |
| Store database | `mariadb-data-ajay-mariadb-0` | StatefulSet claim; Helm never deletes it |
| Gateway SQLite: users, key hashes, servers, audit | `ajay-gateway-data` | `helm.sh/resource-policy: keep` |

`local-path` keeps volumes under `/var/lib/rancher/k3s/storage`. **Not yet tested in production:** data surviving a pod restart or `reboot`, the backup commands below, and a restore.

**Backup** (prints no credentials; the MariaDB password is read inside the pod):

```bash
B=/root/ajay/backups/$(date -u +%Y%m%dT%H%MZ); mkdir -p "$B"
kubectl -n ajay-store exec ajay-mariadb-0 -- sh -c \
  'MYSQL_PWD="$MARIADB_ROOT_PASSWORD" mariadb-dump -uroot --single-transaction --routines --events --all-databases' \
  | gzip > "$B/mariadb.sql.gz"
kubectl -n ajay-store exec deploy/ajay-wordpress -- tar -C /var/www/html -czf - wp-content > "$B/wp-content.tgz"
GW=$(kubectl -n ajay-store get pod -l app.kubernetes.io/name=gateway -o jsonpath='{.items[0].metadata.name}')
kubectl -n ajay-store exec "$GW" -- node -e "new (require('node:sqlite').DatabaseSync)('/data/gateway.db').exec(\"VACUUM INTO '/data/backup.db'\")"
kubectl -n ajay-store cp "$GW:/data/backup.db" "$B/gateway.db" && kubectl -n ajay-store exec "$GW" -- rm /data/backup.db
ls -l "$B"
```

Backups contain customer data, the WooCommerce REST key, password hashes and upstream credentials. Encrypt them (`gpg --symmetric` or `age`) before they leave the server, and never commit them.

**Restore** (untested; rehearse on a scratch cluster first):

1. Scale the writers down: `kubectl -n ajay-store scale deploy/ajay-wordpress deploy/ajay-mcp-woocommerce --replicas=0`.
2. Load the dump: `gunzip -c mariadb.sql.gz | kubectl -n ajay-store exec -i ajay-mariadb-0 -- sh -c 'MYSQL_PWD="$MARIADB_ROOT_PASSWORD" mariadb -uroot'`.
3. Gateway: scale `deploy/ajay-gateway` to 0, copy `gateway.db` to `/data/gateway.db` through a temporary pod that mounts `ajay-gateway-data`, then scale back to 1.
4. Scale WordPress and the WooCommerce MCP back to 1.

## 12. Upgrade and rollback

```bash
cd /opt/ajay && SHA=<new commit>
git fetch origin main && git checkout --detach "$SHA"
# add /root/ajay/images-$SHA.yaml from that commit's workflow run, take a backup (§11)
VALUES=(-f "$CHART/values-prod.yaml" -f /root/ajay/site.yaml -f /root/ajay/images-$SHA.yaml)
helm upgrade ajay "$CHART" -n ajay-store "${VALUES[@]}" --wait --timeout 10m
helm history ajay -n ajay-store
```

Rollback: `helm rollback ajay <revision> -n ajay-store --wait`. Images are pinned by digest, so the old revision runs exactly the old code. Gateway schema changes are additive, so an older gateway works on a newer database. Helm does not roll back data; restore a backup for that.

## 13. Who can read secrets

Access control protects credentials, not instructions. Each of these exposes secret values:

| Access | Exposes |
|---|---|
| Root on the server or the k3s kubeconfig | Every Secret |
| `kubectl exec` into gateway, WooCommerce MCP, WordPress or MariaDB | That pod's credentials, as environment variables |
| `helm get manifest ajay` | The chart-generated `ajay-mcp-business-auth` tokens |
| `/var/lib/rancher/k3s/storage`, backup files | Gateway SQLite, MariaDB data including the REST key |

Anyone else helping on the server should work in a session where the owner approves each command.

## 14. Resources

| Component | Memory, typical |
|---|---|
| k3s with Traefik, CoreDNS, local-path, metrics-server | 0.8–1.0 GB |
| cert-manager | ~0.15 GB |
| WordPress + MariaDB (limits 1 Gi + 768 Mi) | 0.2–0.9 GB |
| Gateway + three MCP servers (limits 512 + 512 + 192 + 256 Mi) | ~0.15–0.4 GB |

Observed after deployment: node at about 120–190m CPU and 1.6–1.7 GiB memory. CPU requests total 450m of 2 vCPU.

## 15. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `helm`: `…image.tag is required` | `images-$SHA.yaml` not passed (§4) |
| `ImagePullBackOff` | GHCR package still private, or wrong digest in `images-$SHA.yaml` |
| `ajay-mcp-woocommerce` in `CreateContainerConfigError` | `ajay-woocommerce-api` or `ajay-mcp-auth` missing (§5, §7) |
| Certificate not Ready | `kubectl -n ajay-store describe challenge`: DNS, port 80 blocked, AAAA record |
| HTTP redirects to `:8443` | Redirect file targets `websecure` instead of `:443` (§9) |
| Storefront redirects to another host | `wordpress.siteUrl` differs from the browser URL |
| WooCommerce tools return 401 | REST key revoked, or not `read_write` |
| Server Unreachable in the dashboard | Pod down or NetworkPolicy; `kubectl -n ajay-store get pods` and the gateway logs |
