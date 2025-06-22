#!/bin/bash
set -euo pipefail

# --- Configuration ---
# First argument: Name of the handler (e.g., "echo", "programmatic")
# This name is used to find the handler code and its specific Dockerfile.
HANDLER_NAME="${1:?Handler name is required (e.g., echo)}"

# Second argument: Path to the handler file and method within the Docker image's FUNCTION_DIR
# e.g., "index.handler" if FUNCTION_DIR/index.js exports 'handler'
HANDLER_FILE_METHOD="${2:?Handler file and method is required (e.g., index.handler)}"

# Third argument: JSON payload string for the test event
TEST_EVENT_PAYLOAD="${3:?Test event JSON payload is required (e.g., '{}')}"

# Fourth argument: Expected string response from the handler
EXPECTED_RESPONSE="${4:?Expected response string is required (e.g., 'success')}"

# Docker image and container naming
BASE_IMAGE_TAG="local/bun-ric-base-image:latest" # Assumes Dockerfile.bun.base is built with this tag
HANDLER_IMAGE_TAG="bun-ric-test-${HANDLER_NAME}:latest"
CONTAINER_NAME="bun-ric-container-${HANDLER_NAME}" # Removed PID for simplicity
NETWORK_NAME="bun-ric-test-network-${HANDLER_NAME}" # Removed PID for simplicity
RIE_HOST_PORT="9000" # Local port to map to RIE's 8080 in the container

# Path to handler code relative to project root (for Docker COPY context)
HANDLER_CODE_SOURCE_DIR="test/integration/test-handlers/${HANDLER_NAME}"
# Dockerfile for the specific handler
HANDLER_DOCKERFILE="test/integration/docker/Dockerfile.bun.${HANDLER_NAME}"

# --- Helper Functions ---
cleanup() {
  echo "Cleaning up..."
  docker stop "${CONTAINER_NAME}" >/dev/null 2>&1 || true
  docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
  docker network rm "${NETWORK_NAME}" >/dev/null 2>&1 || true
  # Optionally remove handler image: docker rmi "${HANDLER_IMAGE_TAG}" >/dev/null 2>&1 || true
  echo "Cleanup finished."
}

# Ensure cleanup happens on script exit or interruption
trap cleanup EXIT SIGINT SIGTERM

# --- Main Script ---
echo "---- Starting Integration Test for Handler: ${HANDLER_NAME} ----"

# 1. Build base image if not already built (simple check, could be more robust)
if ! docker image inspect "${BASE_IMAGE_TAG}" >/dev/null 2>&1; then
  echo "Base image ${BASE_IMAGE_TAG} not found. Building from test/integration/docker/Dockerfile.bun.base..."
  docker build -f test/integration/docker/Dockerfile.bun.base -t "${BASE_IMAGE_TAG}" .
  echo "Base image built."
else
  echo "Base image ${BASE_IMAGE_TAG} found."
fi

# 2. Build handler-specific image
echo "Building handler image ${HANDLER_IMAGE_TAG} from ${HANDLER_DOCKERFILE}..."
if [ ! -f "${HANDLER_DOCKERFILE}" ]; then
    echo "ERROR: Handler Dockerfile ${HANDLER_DOCKERFILE} not found."
    exit 1
fi
if [ ! -d "${HANDLER_CODE_SOURCE_DIR}" ]; then
    echo "ERROR: Handler source directory ${HANDLER_CODE_SOURCE_DIR} not found."
    exit 1
fi
docker build -f "${HANDLER_DOCKERFILE}" -t "${HANDLER_IMAGE_TAG}" . # Assumes Docker context is project root
echo "Handler image built."

# 3. Create Docker network
docker network create "${NETWORK_NAME}" >/dev/null || echo "Network ${NETWORK_NAME} already exists or failed to create."

# 4. Run the handler image with RIE (via docker-entrypoint.sh)
echo "Running container ${CONTAINER_NAME} from image ${HANDLER_IMAGE_TAG}..."
# The CMD in Dockerfile.bun.${HANDLER_NAME} should provide the default bun command and handler.
# We pass the specific handler file/method via _HANDLER env var, which docker-entrypoint.sh should use if AWS_LAMBDA_RUNTIME_API is not set.
# The docker-entrypoint.sh expects the CMD to be [ "bun", "/app/dist/index.js", "actual.handler" ]
# The Dockerfile.bun.${HANDLER_NAME} defines the image's ENTRYPOINT (our RIC) and CMD (the handler string).
# RIE will be used as the entrypoint override.
# RIE will then execute the image's original ENTRYPOINT.
# RIE sets _HANDLER based on the image's CMD or the _HANDLER env var.
# LAMBDA_TASK_ROOT is set by RIE to the image's WORKDIR (/var/task).

docker run \
  --detach \
  --name "${CONTAINER_NAME}" \
  -p "${RIE_HOST_PORT}:8080" \
  --env "LAMBDA_TASK_ROOT=/var/task" \
  --entrypoint "/usr/local/bin/aws-lambda-rie" \
  "${HANDLER_IMAGE_TAG}" \
  "/var/task/entrypoint.sh" "${HANDLER_FILE_METHOD}" # Pass image's ENTRYPOINT and CMD to RIE

echo "Waiting for container ${CONTAINER_NAME} to start (RIE listens on port 8080 inside)..."
# Wait for RIE to be ready - simple sleep, could be more sophisticated
max_retries=10
count=0
while ! curl -s "http://localhost:${RIE_HOST_PORT}/2018-06-01/runtime/invocation/next" > /dev/null 2>&1 && [ ${count} -lt ${max_retries} ]; do
    echo "RIE not ready yet (attempt ${count}/${max_retries})... waiting 1s"
    sleep 1
    count=$((count+1))
done

if [ ${count} -eq ${max_retries} ]; then
    echo "ERROR: RIE did not become ready on port ${RIE_HOST_PORT}."
    docker logs "${CONTAINER_NAME}"
    exit 1
fi
echo "RIE is ready."

# 5. Send test event using curl
echo "Sending event to handler ${HANDLER_FILE_METHOD}: ${TEST_EVENT_PAYLOAD}"
ACTUAL_RESPONSE=$(curl -s -X POST \
  "http://localhost:${RIE_HOST_PORT}/2015-03-31/functions/function/invocations" \
  -d "${TEST_EVENT_PAYLOAD}" --max-time 20) # Increased timeout

echo "Raw actual response: '${ACTUAL_RESPONSE}'"

# 6. Verify response
# Trim whitespace/newlines for comparison if necessary, depending on handler output
TRIMMED_ACTUAL_RESPONSE=$(echo "${ACTUAL_RESPONSE}" | xargs) # xargs trims leading/trailing whitespace and newlines
TRIMMED_EXPECTED_RESPONSE=$(echo "${EXPECTED_RESPONSE}" | xargs)

echo "Comparing trimmed actual: '${TRIMMED_ACTUAL_RESPONSE}' with expected: '${TRIMMED_EXPECTED_RESPONSE}'"

if [ "${TRIMMED_ACTUAL_RESPONSE}" = "${TRIMMED_EXPECTED_RESPONSE}" ]; then
  echo "Test PASSED for handler ${HANDLER_NAME} with event ${TEST_EVENT_PAYLOAD}!"
  # Optionally print logs on success too for debugging
  # echo "--- ${CONTAINER_NAME} logs (success) ---"
  # docker logs "${CONTAINER_NAME}"
else
  echo "Test FAILED for handler ${HANDLER_NAME} with event ${TEST_EVENT_PAYLOAD}!"
  echo "Expected: '${TRIMMED_EXPECTED_RESPONSE}'"
  echo "Got:      '${TRIMMED_ACTUAL_RESPONSE}'"
  echo "--- ${CONTAINER_NAME} logs (failure) ---"
  docker logs "${CONTAINER_NAME}"
  exit 1 # Exit with failure
fi

echo "---- Integration Test for Handler: ${HANDLER_NAME} Finished ----"
# Cleanup is handled by trap
exit 0
