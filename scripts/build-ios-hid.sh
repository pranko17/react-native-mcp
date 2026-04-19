#!/bin/bash
# Build ios-hid Swift helper for iOS Simulator HID injection.
# Produces a universal binary (arm64 + x86_64) in dist/bin/.
# Skips gracefully on non-macOS platforms.

set -e

if [[ "$(uname)" != "Darwin" ]]; then
  echo "ios-hid: Skipping (not macOS)"
  exit 0
fi

if ! command -v swiftc &>/dev/null; then
  echo "ios-hid: Skipping (swiftc not found — install Xcode command line tools)"
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SRC="$PROJECT_DIR/src/swift/ios-hid.swift"
OUT_DIR="$PROJECT_DIR/dist/bin"
OUT="$OUT_DIR/ios-hid"

mkdir -p "$OUT_DIR"

TMP_ARM64=$(mktemp)
TMP_X86=$(mktemp)

cleanup() {
  rm -f "$TMP_ARM64" "$TMP_X86"
}
trap cleanup EXIT

echo "ios-hid: Compiling arm64..."
swiftc -O -target arm64-apple-macosx12.0 -o "$TMP_ARM64" "$SRC" 2>/dev/null || {
  echo "ios-hid: arm64 compilation failed, trying host-only build..."
  swiftc -O -o "$OUT" "$SRC"
  chmod +x "$OUT"
  echo "ios-hid: Built (host architecture only) -> $OUT"
  exit 0
}

echo "ios-hid: Compiling x86_64..."
swiftc -O -target x86_64-apple-macosx12.0 -o "$TMP_X86" "$SRC" 2>/dev/null || {
  cp "$TMP_ARM64" "$OUT"
  chmod +x "$OUT"
  echo "ios-hid: Built (arm64 only) -> $OUT"
  exit 0
}

echo "ios-hid: Creating universal binary..."
lipo -create "$TMP_ARM64" "$TMP_X86" -output "$OUT"
chmod +x "$OUT"
echo "ios-hid: Built (universal arm64+x86_64) -> $OUT"
