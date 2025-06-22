#!/usr/bin/env bun

/**
 * Build script for AWS Lambda Bun Runtime Interface Client Docker Image
 *
 * This script builds the optimized Docker image for the AWS Lambda RIC
 * with Bun runtime. It orchestrates the entire build process and produces
 * a ready-to-use base image for containerized Lambda functions.
 */

/**
 * Build script for AWS Lambda Bun Runtime Interface Client Docker Image
 *
 * This script builds the optimized Docker image for the AWS Lambda RIC
 * with Bun runtime. It orchestrates the entire build process and produces
 * a ready-to-use base image for containerized Lambda functions.
 */

import { exec } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
const IMAGE_NAME = 'aws-lambda-bun-ric';
const IMAGE_TAG = 'latest';
const DOCKERFILE = 'Dockerfile.lambda-base';

async function runCommand(
	command: string,
	errorMessage: string,
): Promise<string> {
	try {
		const { stdout } = await execAsync(command);
		return stdout.trim();
	} catch (error: any) {
		console.error(`❌ ${errorMessage}:`, error.message);
		process.exit(1);
	}
}

async function main() {
	console.log(
		'🚀 Building AWS Lambda Bun Runtime Interface Client Docker Image',
	);

	// Check if Dockerfile exists
	if (!existsSync(DOCKERFILE)) {
		console.error(`❌ Dockerfile not found: ${DOCKERFILE}`);
		process.exit(1);
	}

	// Check if entrypoint.sh exists and is executable
	if (!existsSync('entrypoint.sh')) {
		console.error('❌ entrypoint.sh not found');
		process.exit(1);
	}

	// Ensure entrypoint.sh is executable
	await runCommand(
		'chmod +x entrypoint.sh',
		'Failed to make entrypoint.sh executable',
	);

	// Get git information for image labels
	let gitCommit = '';
	let gitBranch = '';

	try {
		gitCommit = await runCommand(
			'git rev-parse HEAD',
			'Failed to get git commit',
		);
		gitBranch = await runCommand(
			'git rev-parse --abbrev-ref HEAD',
			'Failed to get git branch',
		);
	} catch (error) {
		// Git info is optional, continue if it fails
		console.warn('⚠️ Git information not available, continuing without it');
	}

	// Build timestamp
	const buildTimestamp = new Date().toISOString();

	// Build the Docker image
	console.log(`📦 Building Docker image: ${IMAGE_NAME}:${IMAGE_TAG}`);

	const buildArgs = [
		'docker',
		'build',
		'-f',
		DOCKERFILE,
		'-t',
		`${IMAGE_NAME}:${IMAGE_TAG}`,
		'--build-arg',
		`BUILD_DATE=${buildTimestamp}`,
	];

	// Add git info if available
	if (gitCommit) {
		buildArgs.push('--build-arg', `VCS_REF=${gitCommit}`);
	}
	if (gitBranch) {
		buildArgs.push('--build-arg', `VCS_BRANCH=${gitBranch}`);
	}

	// Add current directory as build context
	buildArgs.push('.');

	await runCommand(buildArgs.join(' '), 'Docker build failed');

	console.log('✅ Docker image built successfully!');
	console.log(`📋 Image details: ${IMAGE_NAME}:${IMAGE_TAG}`);

	// List the image
	await runCommand(
		`docker images ${IMAGE_NAME}:${IMAGE_TAG}`,
		'Failed to list image',
	);

	console.log('\n🎉 Build completed successfully!');
	console.log('📝 Next steps:');
	console.log(`  - Use as base image: FROM ${IMAGE_NAME}:${IMAGE_TAG}`);
	console.log(
		'  - Test with a Lambda function: docker run -p 9000:8080 your-lambda-image',
	);
	console.log(
		'  - Invoke the function: curl -X POST "http://localhost:9000/2015-03-31/functions/function/invocations" -d \'{}\'',
	);
}

main().catch((error) => {
	console.error('❌ Build failed:', error);
	process.exit(1);
});
