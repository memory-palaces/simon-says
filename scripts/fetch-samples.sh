#!/usr/bin/env bash
#
# Fetch optional "famous space" sample models.
#
# HARD CONSTRAINT: this script talks to exactly ONE remote, the official Khronos
# Group glTF sample repository, and nothing else. The host, repo and the exact set
# of folders it may pull are all hardcoded constants below. There is no argument,
# env var, or code path that can point it at another URL. That is deliberate: it
# makes a one-time review of this file sufficient to trust every run, and makes it
# safe to add as a scoped "always approve" permission.
#
#   Repo:  https://github.com/KhronosGroup/glTF-Sample-Assets   (CC-BY / MIT assets)
#
# Usage:  npm run fetch-samples     (or)     bash scripts/fetch-samples.sh
set -euo pipefail

# --- Fixed remote. Do not parameterize. -------------------------------------
readonly REPO="KhronosGroup/glTF-Sample-Assets"
readonly RAW="https://raw.githubusercontent.com/${REPO}/main"
readonly API="https://api.github.com/repos/${REPO}/contents"

# --- Fixed allowlist of folders this script may fetch. ----------------------
# "<repo-model-path>|<local-sample-dir>". Add a line here to enable another space;
# the path is still confined to the Khronos repo above.
readonly FOLDERS=(
  "Models/Sponza/glTF|sponza"
)

readonly DEST_ROOT="$(cd "$(dirname "$0")/.." && pwd)/public/assets/samples"

# Reject anything that isn't a plain repo-relative path (no scheme, no traversal).
# Belt-and-suspenders: the constants above already can't reach another host, but
# this guarantees a bad FOLDERS entry can't smuggle in "../" or an absolute URL.
assert_safe_path() {
  local p="$1"
  case "$p" in
    *://* | /* | *..* )
      echo "refusing unsafe model path: $p" >&2
      exit 1
      ;;
  esac
}

fetch_folder() {
  local model_path="$1" dest="$2"
  assert_safe_path "$model_path"
  local out="${DEST_ROOT}/${dest}"

  echo "==> ${REPO} :: ${model_path}  ->  assets/samples/${dest}"
  mkdir -p "${out}"

  # Get the file list from the API, then pull each raw file from the same repo.
  local names
  names="$(curl -fsSL "${API}/${model_path}" | grep '"name"' | sed -E 's/.*"name": "(.*)",?/\1/')"

  local count=0
  while IFS= read -r name; do
    [ -z "${name}" ] && continue
    curl -fsSL --retry 3 -o "${out}/${name}" "${RAW}/${model_path}/${name}"
    count=$((count + 1))
    printf '\r    %d files…' "${count}"
  done <<< "${names}"
  printf '\r    %d files. done.\n' "${count}"
}

for entry in "${FOLDERS[@]}"; do
  fetch_folder "${entry%%|*}" "${entry##*|}"
done

echo
echo "Done. Sponza is at public/assets/samples/sponza/Sponza.gltf"
echo "Drag it onto the running app, or set it as the default in src/main.ts."
