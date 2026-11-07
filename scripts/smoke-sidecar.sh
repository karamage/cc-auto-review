#!/bin/sh
# 同梱するサーバが単体で起動することを確かめる。Linux 向けのパッケージを作るときに CI で動かす
#
#   scripts/smoke-sidecar.sh <sidecar のパス>
#
# 起動時の確認を通すため、gh と claude はスタブに置き換える。
# SHELL を false にするのは、ログインシェルの PATH にある本物の gh を先に見つけないため
set -eu

sidecar="$1"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

mkdir "$work/bin"
printf '#!/bin/sh\nexit 0\n' > "$work/bin/gh"
printf '#!/bin/sh\necho 2.1.314\n' > "$work/bin/claude"
chmod +x "$work/bin/gh" "$work/bin/claude"

ldd "$sidecar"
# 終了するまで動き続けるサーバなので、timeout で止まるのが正常
SHELL=/bin/false PATH="$work/bin:$PATH" \
  CC_AUTO_REVIEW_HOME="$work/home" CC_AUTO_REVIEW_TOKEN=smoke-test \
  timeout 20 "$sidecar" run dist/server/server.js --desktop --port 0 --client-dir dist/client \
  > "$work/server.log" 2>&1 || true
cat "$work/server.log"
grep -q '^CC_AUTO_REVIEW_READY ' "$work/server.log"
