#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")/.."
test "$(id -u)" = 0
build_id=$(sed -n 's/.*name="robot-build-id" content="\([^"]*\)".*/\1/p' dist/preview.html | head -n 1)
[[ "$build_id" =~ ^build-[a-f0-9]{12}-[0-9]+$ ]] || { echo 'Invalid build ID'; exit 1; }
base=/opt/robot-lab
release="$base/releases/$build_id"
service="$base/services/$build_id"
api="robot-lab-api-$build_id"
network=robot-lab-net
previous=''; previous_api=''; existing=false; switched=false; created_web=false
if docker inspect robot-lab >/dev/null 2>&1; then
    existing=true
    test -L "$base/current"
    previous=$(readlink "$base/current")
    [[ "$previous" =~ ^releases/build-[a-f0-9]{12}-[0-9]+$ ]] || { echo 'Unexpected current release'; exit 1; }
    docker exec robot-lab nginx -t
else
    if ss -ltnH 'sport = :3001' | grep -q .; then echo 'Port 3001 is in use'; exit 1; fi
fi
if test -f "$base/api-current"; then
    previous_api=$(cat "$base/api-current")
    [[ "$previous_api" =~ ^robot-lab-api-build-[a-f0-9]{12}-[0-9]+$ ]] || exit 1
    docker inspect "$previous_api" >/dev/null
fi
test ! -e "$release"; test ! -e "$service"; test -f dist-server/server.mjs
docker image inspect node:22-alpine >/dev/null
mkdir -p -- "$base/releases" "$base/services" "$base/data" "$base/secrets"
chmod 700 "$base/data" "$base/secrets"
if ! test -s "$base/secrets/admin-password"; then
    test -s deploy/.leaderboard-admin-password.txt
    install -m 600 deploy/.leaderboard-admin-password.txt "$base/secrets/admin-password"
fi
mkdir -- "$release" "$service"
cp -a dist/. "$release/"
install -m 644 dist-server/server.mjs "$service/server.mjs"
if test -n "$previous" && test -d "$base/$previous/assets"; then cp -an "$base/$previous/assets/." "$release/assets/"; fi
if ! docker network inspect "$network" >/dev/null 2>&1; then docker network create "$network" >/dev/null; fi
if $existing && ! docker inspect robot-lab --format '{{json .NetworkSettings.Networks}}' | grep -q '"robot-lab-net"'; then docker network connect "$network" robot-lab; fi
backup="$base/nginx.before-$build_id.conf"
if test -f "$base/nginx.conf"; then cp -p "$base/nginx.conf" "$backup"; fi
rollback() {
    result=$?
    trap - EXIT
    if test "$result" -ne 0; then
        if $switched && test -n "$previous"; then ln -s "$previous" "$base/rollback.$build_id"; mv -Tf "$base/rollback.$build_id" "$base/current"; fi
        docker stop "$api" >/dev/null 2>&1 || true
        if test -n "$previous_api"; then docker start "$previous_api" >/dev/null; fi
        # Preserve the inode: this file is already bind-mounted by Nginx.
        if test -f "$backup"; then cat "$backup" > "$base/nginx.conf"; fi
        if $existing; then docker exec robot-lab nginx -t && docker exec robot-lab nginx -s reload || true; fi
        if $created_web; then docker rm -f robot-lab >/dev/null; fi
        echo 'Deployment failed; previous service restored. Score data preserved.' >&2
    fi
    exit "$result"
}
trap rollback EXIT
# There is exactly one score writer. Stop the old process before the new one loads persisted data.
if test -n "$previous_api"; then docker stop --time 20 "$previous_api" >/dev/null; fi
docker run -d --name "$api" --label app=robot-lab-api --restart unless-stopped --network "$network" \
    --read-only --tmpfs /tmp:rw,noexec,nosuid,size=16m --cap-drop ALL --security-opt no-new-privileges \
    -e HOST=0.0.0.0 -e PORT=3002 -e ROBOT_DATA_DIR=/data -e ROBOT_ADMIN_PASSWORD_FILE=/run/admin-password \
    -v "$service:/app:ro" -v "$base/data:/data" -v "$base/secrets/admin-password:/run/admin-password:ro" \
    node:22-alpine node /app/server.mjs >/dev/null
ready=false
for attempt in 1 2 3 4 5; do
    if docker exec "$api" node -e 'fetch("http://127.0.0.1:3002/api/health").then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))'; then ready=true; break; fi
    sleep 1
done
$ready || { echo 'API failed startup'; exit 1; }
sed "s/__ROBOT_API_HOST__/$api/g" deploy/nginx.conf > "$service/nginx.conf"
cat "$service/nginx.conf" > "$base/nginx.conf"
next="$base/current.$build_id.next"
ln -s -- "releases/$build_id" "$next"
mv -Tf -- "$next" "$base/current"
switched=true
if $existing; then
    docker exec robot-lab nginx -t
    docker exec robot-lab nginx -s reload
else
    docker run -d --name robot-lab --label app=robot-lab --restart unless-stopped --network "$network" -p 3001:80 \
        -v "$base:/srv/robot-lab:ro" -v "$base/nginx.conf:/etc/nginx/conf.d/default.conf:ro" nginx:alpine >/dev/null
    created_web=true
    if command -v ufw >/dev/null; then ufw allow 3001/tcp; fi
fi
for attempt in 1 2 3 4 5; do
    if curl --fail --silent http://127.0.0.1:3001/ | grep -Fq "$build_id" \
        && curl --fail --silent http://127.0.0.1:3001/leaderboard.html | grep -Fq "$build_id" \
        && curl --fail --silent http://127.0.0.1:3001/api/health | grep -Fq '"ok":true'; then
        printf '%s\n' "$api" > "$base/api-current"
        echo "Deployed $build_id; previous=$previous; previous_api=$previous_api"
        exit 0
    fi
    sleep 1
done
exit 1
