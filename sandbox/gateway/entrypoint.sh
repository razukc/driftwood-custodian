#!/bin/sh
# Egress gateway: programs nftables from a capgate-compiled policy.
#
# Reads egress[] from /policy/policy.docker.json (mounted read-only) and
# installs a default-DROP output chain that ACCEPTs only the resolved
# IPs of the declared host:port pairs. Containers that join this network
# namespace (--network container:<this>) inherit the firewall and cannot
# remove it (they run with --cap-drop ALL; nftables needs CAP_NET_ADMIN).
#
# DNS stays open to loopback only — Docker's embedded resolver lives at
# 127.0.0.11, so name resolution works while direct connects to anything
# off the allowlist are dropped. Refusals are logged with prefix
# "egress-denied:" (visible via dmesg in the gateway).
set -eu

POLICY=${POLICY:-/policy/policy.docker.json}
REFRESH=${REFRESH:-60}

[ -f "$POLICY" ] || { echo "gateway: policy not found at $POLICY" >&2; exit 1; }

# host:port pairs straight from the compiled policy
PAIRS=$(jq -r '.egress[] | "\(.host) \(.port)"' "$POLICY")
[ -n "$PAIRS" ] || { echo "gateway: policy has empty egress[]" >&2; exit 1; }

nft -f - <<'BASE'
table inet egressgw {
  chain output {
    type filter hook output priority 0; policy drop;
    oifname "lo" accept
    ct state established,related accept
    # DNS via Docker's embedded resolver only (loopback already accepted
    # above; this line documents intent and covers resolver redirects)
    ip daddr 127.0.0.11 udp dport 53 accept
    ip daddr 127.0.0.11 tcp dport 53 accept
    # reject (not drop): the refusal is instant and visible to the caller —
    # the agent reports "connection refused" instead of hanging to timeout
    counter log prefix "egress-denied: " reject with icmpx type admin-prohibited
  }
}
BASE

apply_allowlist() {
  # rebuild the allowlist chain from fresh resolutions; jump rule installed once
  nft list chain inet egressgw allow >/dev/null 2>&1 && nft flush chain inet egressgw allow || nft add chain inet egressgw allow
  nft list chain inet egressgw output | grep -q "jump allow" || \
    nft insert rule inet egressgw output ct state new jump allow

  echo "$PAIRS" | while read -r host port; do
    ips=$(dig +short A "$host" @127.0.0.11 2>/dev/null | grep -E '^[0-9]+\.' || true)
    if [ -z "$ips" ]; then
      echo "gateway: WARN no A records for $host (skipping this round)" >&2
      continue
    fi
    for ip in $ips; do
      nft add rule inet egressgw allow ip daddr "$ip" tcp dport "$port" accept
      echo "gateway: allow $host -> $ip:$port"
    done
  done
}

apply_allowlist
echo "gateway: default-drop active; allowlist programmed from $POLICY"

# periodic re-resolution (DNS rotation); gateway idles as the netns anchor
while true; do
  sleep "$REFRESH"
  apply_allowlist >/dev/null 2>&1 || echo "gateway: WARN refresh failed" >&2
done
