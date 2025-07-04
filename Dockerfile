##############################################################
# Multi-stage Dockerfile for AWS Lambda Bun Runtime Interface Client
# Optimized base image for containerized Lambda functions
##############################################################

# Set up architecture-specific args for caching
ARG TARGETARCH
ARG BASE_IMAGE="bellsoft/alpaquita-linux-base:stream-musl"
ARG BUN_VERSION="1.2.18"
ARG BUNRIC_VERSION="3.3.2"
ARG BUN_AMD64_ISA="default"

FROM ${BASE_IMAGE} AS base

ENV USER=app \
	UID=1000
ENV APP_HOME=/home/${USER}

ENV GROUPNAME=${USER} \
	GID=1000

SHELL ["/bin/ash", "-eu", "-o", "pipefail", "-c"]

ARG TARGETARCH

RUN <<-EOF
	addgroup -g 1000 ${GROUPNAME}
	adduser -h /home/app -g '' -s /bin/ash -G ${GROUPNAME} -D -u 1000 ${USER}
EOF

ARG BUN_VERSION \
	BUN_AMD64_ISA

ENV BUN_VERSION=${BUN_VERSION}

RUN --mount=type=cache,sharing=locked,id=bun-downloads-${TARGETARCH},target=/tmp/bun-cache <<-EOF
	set -eu -o pipefail;
	echo "=== Building for architecture: ${TARGETARCH} ==="
	if [ "${TARGETARCH}" = "amd64" ]; then
		if [ "${BUN_AMD64_ISA}" = "default" ]; then
			BUN_ARCH_SUFFIX="x64-musl"
			BUN_EXTRACT_PATH="bun-linux-x64-musl"
			echo "AMD64 detected - using x64 STANDARD binary"
		elif [ "${BUN_AMD64_ISA}" = "baseline" ]; then
			BUN_ARCH_SUFFIX="x64-musl-baseline"
			BUN_EXTRACT_PATH="bun-linux-x64-musl-baseline"
			echo "AMD64 detected - using x64 BASELINE binary"
		else
			echo "ERROR: Unsupported BUN_AMD64_ISA: ${BUN_AMD64_ISA}" >&2
			exit 1
		fi
	elif [ "${TARGETARCH}" = "arm64" ]; then
		BUN_ARCH_SUFFIX="aarch64-musl"
		BUN_EXTRACT_PATH="bun-linux-aarch64-musl"
		echo "ARM64 detected - using aarch64 binary"
	else
		echo "ERROR: Unsupported architecture: ${TARGETARCH}" >&2
		exit 1
	fi
	echo "=== Downloading Bun ${BUN_VERSION} for ${BUN_ARCH_SUFFIX} ==="
	BUN_ZIP_FILE="/tmp/bun-cache/bun-linux-${BUN_ARCH_SUFFIX}-${BUN_VERSION}.zip"
	if [ ! -f "${BUN_ZIP_FILE}" ]; then
		echo "Downloading Bun binary (not in cache)..."
		wget -O "${BUN_ZIP_FILE}" "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-${BUN_ARCH_SUFFIX}.zip"
	else
		echo "Using cached Bun binary: ${BUN_ZIP_FILE}"
	fi
	unzip -j "${BUN_ZIP_FILE}" "${BUN_EXTRACT_PATH}/bun" -d /tmp
	mv /tmp/bun /usr/bin/bun
	ln -s /usr/bin/bun /usr/bin/bunx
	echo "=== Successfully installed Bun binary for ${TARGETARCH} (${BUN_ARCH_SUFFIX}) ==="
EOF

RUN --mount=type=cache,uid=1000,gid=1000,sharing=locked,id=apk-cache-${TARGETARCH},target=/var/cache/apk <<-EOF
    apk --update add libstdc++
EOF

# Note: assuming only default user is used
# If want to use e.g. "root", you should provide bunfig.toml for root user also
# https://bun.sh/docs/runtime/bunfig#global-vs-local
COPY --chown=1000:1000 resources/.bunfig.toml /home/app/.bunfig.toml

# Set environment variables for Bun
# https://bun.sh/docs/runtime/env#configuring-bun
ENV NODE_ENV=production \
	DO_NOT_TRACK=1 \
	BUN_RUNTIME_TRANSPILER_CACHE_PATH=/tmp/bun \
	TMPDIR=/tmp \
	NO_COLOR=1

USER 1000:1000
WORKDIR /home/app

RUN <<-EOF
	echo "=== Testing Bun installation ==="
	bun --version
EOF



##############################################################
# Stage 1: Create a smaller production image
##############################################################
FROM base AS runner

ENV AWS_LAMBDA_RUNTIME_API=127.0.0.1:8080 \
	LC_ALL=C.utf8 \
	PATH=/home/app/.bun/bin:${PATH}

WORKDIR /home/app

ARG BUNRIC_VERSION

RUN <<-EOF
	bun install --global @aawa/bunric@${BUNRIC_VERSION}
EOF

# include example handler for testing
COPY --chown=1000:1000 resources/index.js ./

ENTRYPOINT ["/home/app/.bun/bin/bunric"]
CMD ["index.handler"]
