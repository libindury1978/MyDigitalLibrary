#!/usr/bin/env bash
# 配置 GitHub 仓库 About/Topics，并发布 Release（需已 gh auth login）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION="${1:-0.1.0}"
TAG="v${VERSION}"

if ! command -v gh >/dev/null 2>&1; then
  echo "请先安装 GitHub CLI: brew install gh"
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "请先登录: gh auth login"
  exit 1
fi

echo "→ 更新仓库简介与 Topics..."
gh repo edit \
  --description "本地数字媒体库桌面应用（Tauri + React）：扫描、分类、排序与预览" \
  --add-topic tauri \
  --add-topic react \
  --add-topic media-library

DMG="release/My_Digital_Library_${VERSION}_aarch64.dmg"
ZIP="release/My_Digital_Library_${VERSION}_aarch64.app.zip"

for f in "$DMG" "$ZIP"; do
  if [[ ! -f "$f" ]]; then
    echo "缺少发布文件: $f"
    echo "请先运行: npm run build:release-app"
    echo "并确保 release/ 下已生成 DMG/ZIP（见 scripts/github-publish.sh 注释或 README）"
    exit 1
  fi
done

NOTES="$(cat <<EOF
## My Digital Library ${TAG}

macOS（Apple Silicon）预编译包。

| 文件 | 说明 |
|------|------|
| \`My_Digital_Library_${VERSION}_aarch64.dmg\` | 磁盘映像，拖入「应用程序」即可 |
| \`My_Digital_Library_${VERSION}_aarch64.app.zip\` | 压缩的 .app，解压后使用 |

从源码构建见 [README](https://github.com/libindury1978/MyDigitalLibrary#从源码运行)。
EOF
)"

echo "→ 创建 Release ${TAG}..."
if gh release view "$TAG" >/dev/null 2>&1; then
  gh release upload "$TAG" "$DMG" "$ZIP" --clobber
  echo "已上传资源到既有 Release: ${TAG}"
else
  gh release create "$TAG" "$DMG" "$ZIP" \
    --title "My Digital Library ${TAG}" \
    --notes "$NOTES"
  echo "已创建 Release: ${TAG}"
fi

echo "完成: https://github.com/libindury1978/MyDigitalLibrary/releases/tag/${TAG}"
