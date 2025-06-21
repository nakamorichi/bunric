#!/usr/bin/env bun

/** Copyright 2023 Amazon.com, Inc. or its affiliates. All Rights Reserved. */

// investigate if can get the file executable with --bytecode
// const pkg = require('src/pkg');
// const { log, run } = pkg;

import { log, run } from '../pkg/index.ts';

// This script is the entrypoint for `bunx aws-lambda-ric`.
// Converted to CommonJS syntax to work with bytecode compilation.

const main = async () => {
	if (process.argv.length < 3) {
		log.error('No handler specified');
		throw new Error('[TEST] No handler specified');
	}

	const appRoot = process.cwd();
	const handler = process.argv[2];

	// Set environment variables that the RIC expects
	process.env._HANDLER = handler;
	process.env.LAMBDA_TASK_ROOT = process.env.LAMBDA_TASK_ROOT || appRoot;

	log.info('Starting AWS Lambda Bun RIC', {
		handler,
		appRoot,
		aws_lambda_runtime_api: process.env.AWS_LAMBDA_RUNTIME_API,
		lambda_task_root: process.env.LAMBDA_TASK_ROOT,
	});

	// Call run directly with the handler parameter
	await run(appRoot, handler);
};

// Export for library usage
export { main };

// Execute main function only when run directly
if (import.meta.main) {
	main().catch((error) => {
		console.error('Fatal error in bin script:', error);
		process.exit(1);
	});
}
