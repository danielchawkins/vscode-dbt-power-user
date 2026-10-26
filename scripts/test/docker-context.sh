# shellcheck shell=sh
# Sourced by the Docker test scripts. When the current Docker context cannot reach a daemon and a Colima context
# can, use Colima for the rest of the script. An explicit DOCKER_HOST or DOCKER_CONTEXT is left alone.
if [ -z "${DOCKER_HOST:-}" ] && [ -z "${DOCKER_CONTEXT:-}" ] && ! docker info > /dev/null 2>&1 &&
  docker --context colima info > /dev/null 2>&1; then
  export DOCKER_CONTEXT=colima
  echo "docker: the current context has no daemon; using the colima context" >&2
fi
