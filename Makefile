target:
	$(info ${HELP_MESSAGE})
	@exit 0

init:
	bun install

test:
	bun run test

# Removed setup-codebuild-agent target as CodeBuild is not being used.
# setup-codebuild-agent:
#	docker build -t codebuild-agent - < test/integration/codebuild-local/Dockerfile.agent

test-smoke: # Removed setup-codebuild-agent dependency
	./test/integration/run-bun-test.sh echo index.handler '{}' 'success'

test-integ: # Removed setup-codebuild-agent dependency
	@echo "Running integration test for 'echo' handler..."
	./test/integration/run-bun-test.sh echo index.handler '{}' 'success'
	@echo "Running integration test for 'programmatic' handler..."
	# The refactored programmatic handler (index.mjs) exports 'handler'
	# and returns a JSON object.
	./test/integration/run-bun-test.sh programmatic index.handler '{"testName":"programmatic"}' '{"message":"success from programmatic handler","eventReceived":{"testName":"programmatic"}}'

format:
	bun run format

# Command to run everytime you make changes to verify everything works
dev: init test

# Verifications to run before sending a pull request
# Note: 'build' target was simplified. 'test-smoke' might need future updates for Bun.
pr: build dev test-smoke

clean:
	bun run clean

build:
	bun run build

pack: build
	bun pack

.PHONY: target init test setup-codebuild-agent test-smoke test-integ format dev pr clean build pack

define HELP_MESSAGE

Usage: $ make [TARGETS]

TARGETS
	format      Run format to automatically update your code to match our formatting (uses Biome).
	build       Builds the package using Bun.
	clean       Cleans the working directory by removing built artifacts.
	dev         Run bun install and then unit tests.
	init        Initialize and install dependencies using Bun.
	pr          Perform checks before submitting a Pull Request (build, dev tests, smoke tests).
	test        Run the Unit tests using Bun.
	pack        Builds and then creates a tarball using bun pack.
	test-smoke  Run smoke tests (Docker-based, may need updates for Bun).
	test-integ  Run integration tests (Docker-based, may need updates for Bun).

endef
