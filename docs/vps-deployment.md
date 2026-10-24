# VPS deployment runbook (k3s on Hostinger)

How the platform goes from a commit on `main` to a single-node k3s cluster on
the Hostinger VPS, with the same Helm chart used locally.

| | |
|---|---|
| Dashboard, `/api`, `/invite` | https://ajay.ajayankam.tech |
| MCP endpoint | https://ajay.ajayankam.tech/mcp |
| Storefront | https://store.ajayankam.tech |
| VPS | Ubuntu 24.04 x86_64, 2 vCPU, 8 GB RAM, 100 GB NVMe |
| Namespace / release | `ajay-store` / `ajay` |
| Chart and values | [deploy/helm/urumi-platform](../deploy/helm/urumi-platform), [values-prod.yaml](../deploy/helm/urumi-platform/values-prod.yaml) |

Rules that apply to every step:

- Deploy only a commit that is on GitHub `main`, with the images CI built from
  that same commit. Never a local build, never a tag that can move.
- The repository holds names, never values. Every credential is created on the
  VPS by the owner and goes straight into a Kubernetes Secret.
- Commands below are run on the VPS in `bash` as the admin user with `sudo`
  rights, unless they say otherwise. Steps that print nothing secret are safe
  to share; the ones that handle credentials are marked **owner only**.

## 1. Order of operations

The order matters because of three dependencies:

1. **The WooCommerce MCP server needs its REST credentials to start.** Its
   Deployment references the `ajay-woocommerce-api` Secret (not optional, by
   design: the server must never run without store credentials), and that
   Secret can only exist after WordPress and WooCommerce are installed.
2. **A fresh WordPress shows its install wizard to whoever opens it first.** DNS
   already points at the VPS, so the store must be installed before any Ingress
   routes to it.
3. **Let's Encrypt needs the Ingress and port 80** to validate each hostname,
   and failed production attempts count against rate limits.

So the release is installed in two phases:

| Phase | What runs | Public routes |
|---|---|---|
| A | MariaDB, WordPress, gateway, Utility, Analytics (`ingress.enabled=false`, `mcpWoocommerce.enabled=false`) | none |
| — | WordPress and WooCommerce installed with WP-CLI through `kubectl exec`; REST key generated straight into its Secret | none |
| B | Full release, staging certificates | HTTPS only (`websecure`) |
| C | Production certificates, then the HTTP→HTTPS redirect | HTTPS, HTTP redirects |

During phase A the gateway lists the WooCommerce server as Unreachable; it
connects on its own once phase B starts the server.

## 2. Images (GitHub Actions → GHCR)

[.github/workflows/images.yml](../.github/workflows/images.yml) runs on every
push to `main` that touches `apps/`, `packages/`, the lockfiles or the workflow,
and on manual dispatch (main only). It:

1. runs the typechecks and unit tests;
2. builds `linux/amd64` images from the repository root with the existing
   Dockerfiles;
3. pushes them with the built-in `GITHUB_TOKEN` (`packages: write`, scoped to
   the run; no personal token):

   | Image | Tag |
   |---|---|
   | `ghcr.io/ajay-ankam/ajay-gateway` | `sha-<40-hex commit>` |
   | `ghcr.io/ajay-ankam/ajay-mcp-business` | `sha-<40-hex commit>` |
   | `ghcr.io/ajay-ankam/ajay-mcp-woocommerce` | `sha-<40-hex commit>` |

   Each image carries `org.opencontainers.image.revision=<commit>` and
   `org.opencontainers.image.source`. There is no `latest` tag.
4. writes the references (tag **and** digest) to the job summary and to the
   `helm-images-<commit>` artifact as `images-<commit>.yaml`, a values file for
   Helm.

`values-prod.yaml` leaves the three application tags empty, so the chart
refuses to render until an `images-<commit>.yaml` is supplied. With a digest,
the chart renders `repository:tag@sha256:...` and the node pulls exactly that
content.

**One-time, after the first successful run (GitHub web UI):** for each of the
three packages, open *Package settings*, set visibility to **Public** and check
it is linked to the repository. The chart has no image pull secret, so private
packages would end in `ImagePullBackOff`. The images contain no credentials
(`.dockerignore` excludes `.env*`, databases and `apps/gateway/data`).

Check anonymous access for a commit (VPS or laptop; prints only digests):

```bash
SHA=<40-hex commit on main>
for i in ajay-gateway ajay-mcp-business ajay-mcp-woocommerce; do
  t=$(curl -fsS "https://ghcr.io/token?scope=repository:ajay-ankam/$i:pull" | sed -E 's/.*"token":"([^"]+)".*/\1/')
  printf '%s ' "$i"
  curl -fsSI -H "Authorization: Bearer $t" \
    -H "Accept: application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json" \
    "https://ghcr.io/v2/ajay-ankam/$i/manifests/sha-$SHA" | grep -i '^docker-content-digest'
done
```

Each digest must equal the one in `images-<commit>.yaml`.

## 3. VPS base

### 3.1 SSH and system

- Log in with an SSH key. In `/etc/ssh/sshd_config.d/` set
  `PasswordAuthentication no` and `PermitRootLogin prohibit-password` (or `no`
  once a sudo user works), then `sudo systemctl reload ssh`. Keep the current
  session open until a second login succeeds.
- `sudo apt update && sudo apt full-upgrade -y`, then enable
  `unattended-upgrades` for security updates.
- `sudo apt install -y gettext-base` if `envsubst` is missing (used once, for
  the ClusterIssuers).
- Clone the public repository (its deploy files are used from §3.4 on; the
  commit is pinned in §4):
  ```bash
  mkdir -p ~/ajay && chmod 700 ~/ajay
  git clone https://github.com/Ajay-Ankam/WooCommerceMCP.git ~/ajay/repo
  cd ~/ajay/repo
  ```

### 3.2 Firewall

Open only SSH, HTTP and HTTPS to the internet, in **both** the Hostinger panel
firewall and `ufw`. The Kubernetes API (6443) stays closed: `kubectl` and
`helm` run on the VPS.

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp            # better: from <your IP> to any port 22
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow from 10.42.0.0/16 # k3s pod network
sudo ufw allow from 10.43.0.0/16 # k3s service network
sudo ufw enable
```

Port 80 must stay open after the redirect: certificate renewals use it.

### 3.3 DNS

Already configured: `ajay.ajayankam.tech` and `store.ajayankam.tech` → the VPS
IPv4. Confirm before requesting certificates:

```bash
dig +short A ajay.ajayankam.tech
dig +short A store.ajayankam.tech
dig +short AAAA ajay.ajayankam.tech store.ajayankam.tech   # must be empty
```

Do not add AAAA records unless IPv6 is opened and tested end to end: Let's
Encrypt prefers IPv6 and would fail validation against a closed address.

### 3.4 k3s

Pin the version (pick the current stable release from
https://github.com/k3s-io/k3s/releases and record it):

```bash
sudo mkdir -p /var/lib/rancher/k3s/server/manifests
sudo cp deploy/k3s/traefik-config.yaml /var/lib/rancher/k3s/server/manifests/
curl -sfL https://get.k3s.io | INSTALL_K3S_VERSION=<v1.xx.y+k3s1> sh -s - \
  --secrets-encryption \
  --write-kubeconfig-mode 600
```

- `--secrets-encryption` encrypts Secrets at rest in the k3s datastore.
- `--write-kubeconfig-mode 600`: `/etc/rancher/k3s/k3s.yaml` is cluster-admin
  and readable by root only. Use `sudo k3s kubectl`, or
  `sudo -i` and `export KUBECONFIG=/etc/rancher/k3s/k3s.yaml` for `helm`.
  Never copy it off the VPS.
- [traefik-config.yaml](../deploy/k3s/traefik-config.yaml) only sets
  `externalTrafficPolicy: Local` (real client IPs for the login throttle). It
  has **no** redirect; that comes in phase C.

Verify:

```bash
kubectl get nodes                                    # Ready
kubectl -n kube-system get pods                      # traefik, coredns, local-path-provisioner, metrics-server Running
kubectl get storageclass                             # local-path (default)
kubectl get ingressclass                             # traefik
kubectl -n kube-system get pods -l app.kubernetes.io/name=traefik   # label used by the NetworkPolicies
```

k3s enforces NetworkPolicies with its built-in controller; nothing else is
needed.

### 3.5 Helm and cert-manager

Install Helm from the official release (https://helm.sh/docs/intro/install/),
then cert-manager with a pinned chart version:

```bash
helm repo add jetstack https://charts.jetstack.io && helm repo update
helm search repo jetstack/cert-manager           # note the version, pin it below
helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager --create-namespace \
  --version <vX.Y.Z> --set crds.enabled=true --wait
kubectl -n cert-manager get pods                  # 3 pods Running
```

ClusterIssuers (the contact email is substituted at apply time, never
committed):

```bash
export ACME_EMAIL=<your contact email>
envsubst '$ACME_EMAIL' < deploy/k3s/cluster-issuer-staging.yaml | kubectl apply -f -
envsubst '$ACME_EMAIL' < deploy/k3s/cluster-issuer.yaml | kubectl apply -f -
kubectl get clusterissuer                         # both READY True
```

Both use HTTP-01 through Traefik. cert-manager creates a temporary solver pod
and Ingress in `ajay-store`; the chart's NetworkPolicies select only release
pods (`app.kubernetes.io/instance=ajay`), so solvers are not blocked.

## 4. Source and image references on the VPS

```bash
cd ~/ajay/repo
SHA=<40-hex commit on main that CI built>
git fetch origin main && git merge-base --is-ancestor "$SHA" origin/main && git checkout --detach "$SHA"
git rev-parse HEAD                                # must equal $SHA
```

Copy the YAML from the workflow's job summary (or the `helm-images-<SHA>`
artifact) to `~/ajay/images-$SHA.yaml`. It contains image names, tags and
digests only.

Site settings that are not secret but not committed either:

```bash
cat > ~/ajay/site.yaml <<'EOF'
gateway:
  bootstrapAdminEmail: <first admin email>
EOF
```

Helm arguments used by every install and upgrade below:

```bash
CHART=~/ajay/repo/deploy/helm/urumi-platform
VALUES=(-f "$CHART/values-prod.yaml" -f ~/ajay/site.yaml -f ~/ajay/images-$SHA.yaml)
```

## 5. Namespace and Secrets (owner only)

```bash
kubectl create namespace ajay-store
```

| Secret | Keys | Used by |
|---|---|---|
| `ajay-mariadb-auth` | `root-password`, `user-password` | MariaDB, WordPress |
| `ajay-mcp-auth` | `token` | WooCommerce MCP server and the gateway (bearer between them) |
| `ajay-gateway` | `BOOTSTRAP_ADMIN_PASSWORD`, `GEMINI_API_KEY`, `GROQ_API_KEY` (all optional) | gateway |
| `ajay-woocommerce-api` | `consumer-key`, `consumer-secret` | WooCommerce MCP server (created in §7) |
| `ajay-mcp-business-auth` | `utility-token`, `analytics-token` | generated by the chart on first install |

Values never appear on a command line, in shell history or on screen. They are
written to a RAM-backed file readable only by you, loaded, then destroyed:

```bash
umask 077
f=$(mktemp -p /dev/shm)
printf 'root-password=%s\nuser-password=%s\n' "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" > "$f"
kubectl -n ajay-store create secret generic ajay-mariadb-auth --from-env-file="$f"
printf 'token=%s\n' "$(openssl rand -hex 32)" > "$f"
kubectl -n ajay-store create secret generic ajay-mcp-auth --from-env-file="$f"
shred -u "$f"
```

Gateway Secret: the admin password (at least 10 characters) and LLM keys are
typed without echo:

```bash
umask 077
f=$(mktemp -p /dev/shm)
read -rsp 'Bootstrap admin password: ' p; echo; printf 'BOOTSTRAP_ADMIN_PASSWORD=%s\n' "$p" >> "$f"
read -rsp 'Gemini API key (blank to skip): ' p; echo; [ -n "$p" ] && printf 'GEMINI_API_KEY=%s\n' "$p" >> "$f"
read -rsp 'Groq API key (blank to skip): ' p; echo; [ -n "$p" ] && printf 'GROQ_API_KEY=%s\n' "$p" >> "$f"
unset p
kubectl -n ajay-store create secret generic ajay-gateway --from-env-file="$f"
shred -u "$f"
kubectl -n ajay-store get secrets                 # names only
```

Use new values for the VPS; do not reuse local or development ones.

## 6. Phase A: install without public routes

```bash
helm upgrade --install ajay "$CHART" -n ajay-store "${VALUES[@]}" \
  --set ingress.enabled=false \
  --set mcpWoocommerce.enabled=false \
  --wait --timeout 15m
kubectl -n ajay-store get pods,pvc
kubectl -n ajay-store get ingress                 # No resources found
```

Expected: `ajay-mariadb-0`, WordPress, gateway, Utility and Analytics Running
and Ready; three PVCs Bound on `local-path`. Check that the pods run the
intended images:

```bash
kubectl -n ajay-store get pods -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.containers[0].image}{"\n"}{end}'
```

## 7. Store bootstrap (still no public route)

WP-CLI runs inside the WordPress pod as `www-data`, through `kubectl exec`
(the Kubernetes API, not the network). Pin the WP-CLI release and verify its
checksum:

```bash
WP=$(kubectl -n ajay-store get pod -l app.kubernetes.io/name=wordpress -o jsonpath='{.items[0].metadata.name}')
WPCLI=2.12.0   # current release from https://github.com/wp-cli/wp-cli/releases
kubectl -n ajay-store exec "$WP" -- sh -c "
  set -e
  curl -fsSLo /tmp/wp-cli.phar https://github.com/wp-cli/wp-cli/releases/download/v$WPCLI/wp-cli-$WPCLI.phar
  curl -fsSL https://github.com/wp-cli/wp-cli/releases/download/v$WPCLI/wp-cli-$WPCLI.phar.sha512 \
    | awk '{print \$1\"  /tmp/wp-cli.phar\"}' | sha512sum -c -
  chmod 0755 /tmp/wp-cli.phar"
wp() { kubectl -n ajay-store exec -i "$WP" -- runuser -u www-data -- \
  php -d memory_limit=512M /tmp/wp-cli.phar --path=/var/www/html "$@"; }
```

`/tmp` is not on the PVC: if the pod restarts, repeat the download.

**Install WordPress (owner only).** The admin password is typed without echo
and reaches WP-CLI on stdin (`--prompt`), never as an argument:

```bash
wp core is-installed && echo "already installed" || {
  read -rsp 'WordPress admin password: ' p; echo
  printf '%s\n' "$p" | wp core install \
    --url=https://store.ajayankam.tech --title="Ajay Store" \
    --admin_user=<admin login> --admin_email=<admin email> \
    --skip-email --prompt=admin_password
  unset p
}
```

**WooCommerce, INR and Cash on Delivery** (idempotent):

```bash
wp plugin is-installed woocommerce || wp plugin install woocommerce
wp plugin activate woocommerce
wp rewrite structure '/%postname%/'
wp option update woocommerce_currency INR
wp option update woocommerce_coming_soon no
wp option update woocommerce_cod_settings '{"enabled":"yes","title":"Cash on delivery","description":"Pay with cash upon delivery.","instructions":"Pay with cash upon delivery."}' --format=json
wp wc tool run install_pages --user=1
wp option get woocommerce_currency                 # INR
wp option get permalink_structure                 # /%postname%/
```

**REST API key → Secret (owner only).** The key pair is generated inside the
pod the same way WooCommerce's own key screen does (`wc_rand_hash`, consumer
key stored as `wc_api_hash`), then piped into a RAM file and the Secret. It is
never displayed. Run it once; if `ajay-woocommerce-api` already exists, skip it
(to rotate, revoke the key in *WooCommerce → Settings → Advanced → REST API*
and repeat).

```bash
umask 077
f=$(mktemp -p /dev/shm)
wp eval-file - > "$f" <<'PHP'
<?php
global $wpdb;
$user = get_user_by( 'id', 1 );
if ( ! $user || ! user_can( $user, 'manage_woocommerce' ) ) { fwrite( STDERR, "user 1 cannot manage WooCommerce\n" ); exit( 1 ); }
$ck = 'ck_' . wc_rand_hash();
$cs = 'cs_' . wc_rand_hash();
$ok = $wpdb->insert( $wpdb->prefix . 'woocommerce_api_keys', array(
  'user_id'         => $user->ID,
  'description'     => 'ajay-mcp-woocommerce',
  'permissions'     => 'read_write',
  'consumer_key'    => wc_api_hash( $ck ),
  'consumer_secret' => $cs,
  'truncated_key'   => substr( $ck, -7 ),
) );
if ( ! $ok ) { fwrite( STDERR, "insert failed\n" ); exit( 1 ); }
echo "consumer-key=$ck\nconsumer-secret=$cs\n";
PHP
[ "$(grep -cE '^consumer-(key=ck|secret=cs)_[0-9a-f]{40}$' "$f")" = 2 ] \
  && kubectl -n ajay-store create secret generic ajay-woocommerce-api --from-env-file="$f" \
  || echo "key generation failed; nothing created"
shred -u "$f"
```

`read_write` is required: the admin-only `create_product` and
`update_order_status` tools write through this key. If anything here fails,
the fallback is creating the key in the WooCommerce admin after phase B (the
store is installed by then, so there is no wizard to expose) and loading it
with the `read -rs` pattern from §5.

## 8. Phase B: full release with staging certificates

```bash
helm upgrade ajay "$CHART" -n ajay-store "${VALUES[@]}" \
  --set ingress.tls.clusterIssuer=letsencrypt-staging \
  --wait --timeout 10m
kubectl -n ajay-store get pods                    # all Ready, including ajay-mcp-woocommerce
kubectl -n ajay-store get ingress                 # ajay-gateway, ajay-store
kubectl -n ajay-store get certificate             # ajay-gateway-tls, ajay-store-tls READY True (1-3 min)
```

If a certificate stays not ready:
`kubectl -n ajay-store describe certificate,certificaterequest,order,challenge`
(DNS, port 80 and the Hostinger firewall are the usual causes).

Check routing (staging certificates are untrusted, hence `-k` here only):

```bash
curl -sk -o /dev/null -w '%{http_code}\n' https://ajay.ajayankam.tech/health      # 200
curl -sk -o /dev/null -w '%{http_code}\n' https://store.ajayankam.tech/           # 200
curl -sk -o /dev/null -w '%{http_code}\n' -X POST https://ajay.ajayankam.tech/mcp # 401 without a key
echo | openssl s_client -connect store.ajayankam.tech:443 -servername store.ajayankam.tech 2>/dev/null | openssl x509 -noout -issuer   # (STAGING) issuer
```

## 9. Phase C: production certificates, then redirect

```bash
helm upgrade ajay "$CHART" -n ajay-store "${VALUES[@]}" --wait --timeout 10m
kubectl -n ajay-store get certificate -w          # both re-issued by letsencrypt-prod
curl -sS -o /dev/null -w '%{http_code}\n' https://ajay.ajayankam.tech/health      # 200, no -k
```

cert-manager re-issues when the Ingress names another issuer. Only after both
certificates are Ready from production, enable the redirect (replaces the same
HelmChartConfig):

```bash
sudo cp deploy/k3s/traefik-config-redirect.yaml /var/lib/rancher/k3s/server/manifests/traefik-config.yaml
kubectl -n kube-system rollout status deploy/traefik
curl -sI http://store.ajayankam.tech/ | head -3   # 301/308 to https://
```

The redirect uses Traefik static entry point flags (`additionalArguments`). If
the k3s Traefik chart already sets `additionalArguments`
(`kubectl -n kube-system get helmchart traefik -o yaml`), merge them into
the file first.

## 10. Smoke tests

1. **Dashboard:** log in at https://ajay.ajayankam.tech as the bootstrap admin.
   *Servers*: WooCommerce Store, Utility, Sales Analytics all **Connected**
   (6 + 5 + 5 tools).
2. **Remove the bootstrap password** (it is only read on an empty database):
   ```bash
   kubectl -n ajay-store patch secret ajay-gateway --type=json \
     -p='[{"op":"remove","path":"/data/BOOTSTRAP_ADMIN_PASSWORD"}]'
   ```
3. **Member and key:** invite a member, accept the invite, issue a key in
   *Keys* (shown once).
4. **External MCP client** (laptop). The key stays in the `AJAY_KEY`
   environment variable; the config file holds only the placeholder, which
   Claude Code expands at runtime, so the key is not written to disk:
   ```bash
   cat > ajay-vps.mcp.json <<'EOF'
   {"mcpServers":{"ajay-vps":{"type":"http","url":"https://ajay.ajayankam.tech/mcp","headers":{"Authorization":"Bearer ${AJAY_KEY}"}}}}
   EOF
   claude --strict-mcp-config --mcp-config ajay-vps.mcp.json
   ```
   Expect 14 tools for a member (16 for an admin); `list_orders` followed by
   `analytics__summarize_sales` exercises two upstreams. Revoke the key
   afterwards and confirm the next call is rejected (401 `API_KEY_REVOKED`).
5. **Storefront:** place a Cash on Delivery order at
   https://store.ajayankam.tech; it appears in WooCommerce admin and through
   chat ("what orders came in today?").
6. **Chat as admin:** create a product (approval card), then see it on the
   storefront.
7. **Audit:** every call above appears under the right user.
8. **NetworkPolicy negative test** (throwaway pod, removed on exit; expect
   timeouts):
   ```bash
   kubectl -n ajay-store run np-test --rm -it --restart=Never --image=curlimages/curl:8.11.1 -- \
     sh -c 'curl -m 5 -s http://ajay-mcp-woocommerce:3001/health; echo "woo exit=$?"; nc -z -w 5 ajay-mariadb 3306; echo "mariadb exit=$?"'
   ```
   Expected `woo exit=28` (timeout) and `mariadb exit=1`. The same pod
   reaching `https://example.org` shows that only the policy blocks it.
9. **Failure isolation:** `kubectl -n ajay-store delete pod -l app.kubernetes.io/name=mcp-analytics`;
   the dashboard shows it Unreachable, other tools keep working, and it
   recovers.

## 11. Persistence

| Data | Where | PVC |
|---|---|---|
| WordPress core, plugins, uploads, `wp-config.php` | `/var/www/html` | `ajay-wordpress-data` (`helm.sh/resource-policy: keep`) |
| Store database | `/var/lib/mysql` | `mariadb-data-ajay-mariadb-0` (StatefulSet; never deleted by Helm) |
| Gateway users, key hashes, servers, audit, chat | `/data/gateway.db` | `ajay-gateway-data` (`helm.sh/resource-policy: keep`) |

`local-path` stores them under `/var/lib/rancher/k3s/storage` on the VPS disk.
Verify persistence with `sudo reboot`: after about two minutes all pods are
Ready again, the test order, product, users and audit rows are still there,
and both certificates are still valid.

## 12. Backups

Run as root into `~/ajay/backups` (mode 700). The commands print no
credentials: the MariaDB password is read from the container environment
inside the pod.

```bash
B=~/ajay/backups/$(date -u +%Y%m%dT%H%MZ); mkdir -p "$B"
# Store database (consistent InnoDB snapshot)
kubectl -n ajay-store exec ajay-mariadb-0 -- sh -c \
  'MYSQL_PWD="$MARIADB_ROOT_PASSWORD" mariadb-dump -uroot --single-transaction --routines --events --all-databases' \
  | gzip > "$B/mariadb.sql.gz"
# WordPress files
kubectl -n ajay-store exec deploy/ajay-wordpress -- tar -C /var/www/html -czf - wp-content > "$B/wp-content.tgz"
# Gateway SQLite (online, consistent copy)
GW=$(kubectl -n ajay-store get pod -l app.kubernetes.io/name=gateway -o jsonpath='{.items[0].metadata.name}')
kubectl -n ajay-store exec "$GW" -- node -e "const {DatabaseSync}=require('node:sqlite');new DatabaseSync('/data/gateway.db').exec(\"VACUUM INTO '/data/backup.db'\")"
kubectl -n ajay-store cp "$GW:/data/backup.db" "$B/gateway.db"
kubectl -n ajay-store exec "$GW" -- rm /data/backup.db
ls -l "$B"
```

These files contain the WooCommerce data, customer details, the stored REST
key, password hashes and upstream credentials: encrypt them (`gpg --symmetric`
or `age`) before copying them off the VPS, and keep them out of the
repository. Before relying on them, restore once into a scratch MariaDB
(`kubectl run` a temporary `mariadb` pod, load the dump, count `wp_posts`) and
open the gateway copy with `node:sqlite`.

Restore, if ever needed: scale the consumer to 0, then
`gunzip -c mariadb.sql.gz | kubectl exec -i ajay-mariadb-0 -- sh -c 'MYSQL_PWD="$MARIADB_ROOT_PASSWORD" mariadb -uroot'`;
for the gateway, copy the file back to `/data/gateway.db` while the gateway is
scaled to 0 (through a temporary pod mounting the PVC).

## 13. Upgrades and rollback

1. Merge to `main`; the workflow builds `sha-<new commit>` images.
2. On the VPS: `git fetch && git checkout --detach <new>`, add
   `~/ajay/images-<new>.yaml`, set `SHA=<new>`, take a backup (§12).
3. `helm upgrade ajay "$CHART" -n ajay-store "${VALUES[@]}" --wait --timeout 10m`
4. `helm history ajay -n ajay-store`

Rollback: `helm rollback ajay <revision> -n ajay-store --wait`. Images are
pinned by digest, so the previous revision runs exactly the previous code.
Gateway schema changes are additive (new tables and columns only), so an older
gateway keeps working on a newer database. Helm does not roll back data;
restoring data means restoring a backup.

## 14. Who can see secrets

Instructions do not protect credentials; permissions do. Any of these gives
access to secret values, so they stay with the owner:

| Permission | Exposes |
|---|---|
| Root or `sudo` on the VPS, or `/etc/rancher/k3s/k3s.yaml` | Every Secret (`kubectl get secret -o yaml`) |
| `kubectl exec` into gateway, WooCommerce MCP, MariaDB or WordPress | Their credentials as environment variables |
| `helm get manifest` on the release | The chart-generated `ajay-mcp-business-auth` tokens (stored in the release record) |
| `/var/lib/rancher/k3s/storage` | Gateway SQLite (upstream credentials added in the dashboard), MariaDB files (WooCommerce REST key, customer data) |
| Backup files | Same as the volumes |
| Shell history / process arguments | Nothing, if the patterns above are followed; they keep values out of both |

An assistant or second person helping on the VPS should work in a session
where the owner approves every command, without `sudo` or the kubeconfig.

## 15. Resources (8 GB VPS)

| Component | Memory, typical |
|---|---|
| k3s (server, Traefik, CoreDNS, local-path, metrics-server) | 0.8–1.0 GB |
| cert-manager | ~0.15 GB |
| MariaDB + WordPress | 0.5–0.9 GB (limits 768 Mi + 1 Gi) |
| Gateway + three MCP servers | ~0.4 GB (limits 512 + 512 + 192 + 256 Mi) |
| **Total** | **~2–2.5 GB typical, under 4.5 GB at every limit** |

CPU requests total 450m of 2 vCPU; the WooCommerce install and image pulls
are the only spikes.

## 16. Troubleshooting

| Symptom | Cause |
|---|---|
| `ajay-mcp-woocommerce` in `CreateContainerConfigError` | `ajay-woocommerce-api` (or `ajay-mcp-auth`) missing: §5, §7 |
| `ImagePullBackOff` on gateway or MCP pods | Package still private, or wrong commit/digest in `images-<SHA>.yaml` |
| `helm` error `...image.tag is required` | `images-<SHA>.yaml` not passed |
| Certificate not ready | `kubectl describe challenge`: DNS, closed port 80, AAAA record |
| Storefront redirects to another host | `wordpress.siteUrl` differs from the browser URL |
| WooCommerce tools return 401 | REST key revoked or not `read_write` |
