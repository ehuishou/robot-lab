#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")/.."
test "$(id -u)" = 0
build_id=$(sed -n 's/.*name="robot-build-id" content="\([^"]*\)".*/\1/p' dist/preview.html | head -n 1)
[[ "$build_id" =~ ^build-[a-f0-9]{12}-[0-9]+$ ]] || { echo 'Invalid build ID'; exit 1; }
base=/opt/robot-lab
release="$base/releases/$build_id"
if docker container inspect robot-lab >/dev/null 2>&1; then
    echo 'robot-lab container already exists; inspect it before updating.' >&2
    exit 1
fi
if ss -ltnH 'sport = :3001' | grep -q .; then
    echo 'Port 3001 is already in use.' >&2
    exit 1
fi
mkdir -p -- "$base/releases"
test ! -e "$release"
mkdir -- "$release"
cp -a dist/. "$release/"
cp deploy/nginx.conf "$base/nginx.conf"
ln -sfn -- "releases/$build_id" "$base/current"
docker run --rm --network none -v "$base:/srv/robot-lab:ro" -v "$base/nginx.conf:/etc/nginx/conf.d/default.conf:ro" nginx:alpine nginx -t
docker run -d --name robot-lab --label app=robot-lab --restart unless-stopped -p 3001:80 -v "$base:/srv/robot-lab:ro" -v "$base/nginx.conf:/etc/nginx/conf.d/default.conf:ro" nginx:alpine
ufw allow 3001/tcp
for attempt in 1 2 3 4 5; do
    if curl --fail --silent http://127.0.0.1:3001/ > /dev/null; then
        echo "Deployed $build_id at http://121.199.30.133:3001/"
        exit 0
    fi
    sleep 1
done
echo 'Container started but HTTP health check failed.' >&2
exit 1
