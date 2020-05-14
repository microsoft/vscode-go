#!/bin/bash -e

# Copyright (C) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License. See LICENSE in the project root for license information.

usage() {
  cat <<EOUSAGE
Usage: $0 [subcommand]
Available subcommands:
  help      - display this help message.
  test      - build and test locally. Some tests may fail if vscode is alreay in use.
  testlocal - build and test in a locally built container.
  ci        - build and test with headless vscode. Requires Xvfb.
EOUSAGE
}

# TODO(hyangah): commands for building docker container and running tests locally with docker run.
root_dir() {
  local script_name=$(readlink -f "${0}")
  local script_dir=$(dirname "${script_name}")
  local parent_dir=$(dirname "${script_dir}")
  echo "${parent_dir}"
}

setup_virtual_display() {
  echo "**** Set up virtual display ****"
  # Start xvfb (an in-memory display server for UNIX-like operating system)
  # so we can launch a headless vscode for testing.
  /usr/bin/Xvfb :99 -screen 0 1024x768x24 > /dev/null 2>&1 &
  trap 'kill "$(jobs -p)"' EXIT
  export DISPLAY=:99
  sleep 3  # Wait for xvfb to be up.
}

go_binaries_info() {
  echo "**** Go version ****"
  which go
  go version
  echo "**** Gopls version ****"
  go version -m "$(which gopls)"
}

run_test() {
  echo "**** Run test ****"
  npm ci
  npm run compile
  npm run lint
  npm run unit-test
  npm test --silent
}

run_test_in_docker() {
  echo "**** Building the docker image ***"
  docker build -t vscode-test-env ./build
  docker run --workdir=/workspace -v "$(pwd):/workspace" vscode-test-env ci
}

main() {
  cd "$(root_dir)"  # always run from the script root.
  case "$1" in
    "help"|"-h"|"--help")
      usage
      exit 0
      ;;
    "test")
      go_binaries_info
      run_test
      ;;
    "testlocal")
      run_test_in_docker
      ;;
    "ci")
      go_binaries_info
      setup_virtual_display
      run_test
      ;;
    *)
      usage
      exit 2
  esac
}
main $@