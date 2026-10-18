#!/usr/bin/env bash
# Assembles the site exactly as .github/workflows/pages.yml does, serves it with a plain static
# server (no development-server help), and runs the browser flow against its demo (?demo).
# A phone-size harness is added for the test only; it is not part of the published site.
#   tools/pages-check.sh [port]      (needs geckodriver on :4444)
set -euo pipefail
cd "$(dirname "$0")/.."
port="${1:-8792}"
site=".dev/_site"
rm -rf "$site"
mkdir -p "$site/worker" "$site/config"
cp -r web/. "$site/"
cp -r shared "$site/shared"
cp -r worker/src worker/migrations worker/data "$site/worker/"
cp config/*.json "$site/config/"
touch "$site/.nojekyll"
mkdir -p "$site/__phone"
cat > "$site/__phone/index.html" <<'HTML'
<!doctype html><meta charset="utf-8"><style>body{margin:0}</style>
<iframe id="phone" src="/?demo#/" style="border:0"></iframe>
<script>const q = new URLSearchParams(location.search); const f = document.getElementById('phone');
f.style.width = (q.get('w') || 390) + 'px'; f.style.height = (q.get('h') || 844) + 'px';</script>
HTML
grep -q "has('demo')" "$site/config.js" || { echo "config.js does not switch to the demo on ?demo"; exit 1; }
python3 -m http.server "$port" --bind 127.0.0.1 --directory "$site" > .dev/pages-check.log 2>&1 &
server=$!
trap 'kill $server 2>/dev/null || true' EXIT
for _ in $(seq 1 30); do curl -sf "http://127.0.0.1:$port/" >/dev/null && break; sleep 0.3; done
echo "Serving the assembled site on :$port ($(du -sh "$site" | cut -f1))"
node tools/browser-flow.mjs "http://127.0.0.1:$port/?demo"
