#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")/.."
test "$(id -u)" = 0
build_id=$(sed -n 's/.*name="robot-build-id" content="\([^"]*\)".*/\1/p' dist/preview.html | head -n 1)
[[ "$build_id" =~ ^build-[a-f0-9]{12}-[0-9]+$ ]] || { echo 'Invalid build ID'; exit 1; }
base=/opt/robot-lab
release="$base/releases/$build_id"
test -L "$base/current"
previous=$(readlink "$base/current")
[[ "$previous" =~ ^releases/build-[a-f0-9]{12}-[0-9]+$ ]] || { echo 'Unexpected current release'; exit 1; }
docker inspect robot-lab >/dev/null
docker exec robot-lab nginx -t
test ! -e "$release"
mkdir -- "$release"
cp -a dist/. "$release/"
# Keep hashed assets available for browser tabs opened before this update.
if test -d "$base/$previous/assets"; then
    cp -an "$base/$previous/assets/." "$release/assets/"
fi
next="$base/current.$build_id.next"
ln -s -- "releases/$build_id" "$next"
mv -Tf -- "$next" "$base/current"
for attempt in 1 2 3 4 5; do
    if curl --fail --silent http://127.0.0.1:3001/ | grep -Fq "$build_id"; then
        echo "Deployed $build_id; previous=$previous"
        exit 0
    fi
    sleep 1
done
ln -s -- "$previous" "$next"
mv -Tf -- "$next" "$base/current"
echo 'Health check failed; previous release restored.' >&2
exit 1
