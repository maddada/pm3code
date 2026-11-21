#!/usr/bin/env bash
# t3code-pm: build the fork's signed Android APK locally (no EAS), installable beside T3 Code.
#
#   T3CODE_PM_KEYSTORE=~/keys/t3code-pm.keystore \
#   T3CODE_PM_KEYSTORE_PASSWORD_FILE=~/keys/t3code-pm.password \
#   scripts/pm-build-apk.sh [output-dir]
#
# The keystore and its password stay outside the repo. The app never checks upstream's
# over-the-air update channel (T3CODE_MOBILE_UPDATES_ENABLED=0), and gets no hosted pushes.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)/apps/mobile"

keystore="${T3CODE_PM_KEYSTORE:?Set T3CODE_PM_KEYSTORE to the fork keystore}"
password_file="${T3CODE_PM_KEYSTORE_PASSWORD_FILE:?Set T3CODE_PM_KEYSTORE_PASSWORD_FILE}"
alias="${T3CODE_PM_KEY_ALIAS:-t3code-pm}"
abis="${T3CODE_PM_ABIS:-arm64-v8a}"
out_dir="${1:-$PWD/build-pm}"
password="$(cat "$password_file")"

export APP_VARIANT=pm
export T3CODE_MOBILE_UPDATES_ENABLED=0
export EXPO_NO_GIT_STATUS=1
export NODE_ENV=production

# T3CODE_PM_PREBUILD=0 reuses the last generated android/ project for a faster rebuild.
if [[ "${T3CODE_PM_PREBUILD:-1}" != "0" || ! -d android ]]; then
  vp exec expo prebuild --clean --platform android --no-install
fi
# Gradle's bundle task only watches apps/mobile; drop the last bundle so shared packages land too.
rm -rf android/app/build/generated/assets/react android/app/build/generated/assets/createBundleReleaseJsAndAssets
(
  cd android
  ./gradlew assembleRelease \
    -PreactNativeArchitectures="$abis" \
    -Pandroid.injected.signing.store.file="$keystore" \
    -Pandroid.injected.signing.store.password="$password" \
    -Pandroid.injected.signing.key.alias="$alias" \
    -Pandroid.injected.signing.key.password="$password"
)

mkdir -p "$out_dir"
version="$(node -p "require('./android/app/build/outputs/apk/release/output-metadata.json').elements[0].versionName")"
apk="$out_dir/t3code-pm-$version.apk"
cp android/app/build/outputs/apk/release/app-release.apk "$apk"
echo "$apk"
