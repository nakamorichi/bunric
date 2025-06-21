/**
 * Copyright 2022 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *
 * This module is the bootstrap entrypoint. It establishes the top-level event
 * listeners and loads the user's code.
 */

// Attempt to patch console ASAP for debugging.
import * as LogPatch from './LogPatch.ts';

LogPatch.patchConsole(); // Patch immediately

console.log('RIC_DEBUG: src/index.ts top level, console patched.');

import * as BeforeExitListener from './BeforeExitListener.ts';
import * as Errors from './Errors.ts';
import { log } from './Logger.ts';
import RAPIDClient from './RAPIDClient.ts';
import Runtime from './Runtime.ts';
import * as UserFunction from './UserFunction.ts';
// LogPatch already imported
import { logger } from './VerboseLog.ts';

const { verbose } = logger('INDEX');

console.log('RIC_DEBUG: imports done, logger initialized');

// Define a type for the handler function
type LambdaHandler = (...args: any[]) => any;

interface ErrorCallbacks {
	uncaughtException: (error: Error) => void;
	unhandledRejection: (error: Error) => void;
}

async function run(
	appRootOrHandler: string | LambdaHandler,
	handler: string = '',
): Promise<void> {
	console.log(
		`RIC_DEBUG: run() called with appRootOrHandler: ${typeof appRootOrHandler === 'string' ? appRootOrHandler : '[Function]'}, handler: ${handler}`,
	);
	// LogPatch.patchConsole(); // Moved to top level

	// RAPIDClient constructor now doesn't take hostnamePort, it reads from env var internally via BunRapidClient
	const client = new RAPIDClient(process.env.AWS_LAMBDA_RUNTIME_API);

	const errorCallbacks: ErrorCallbacks = {
		uncaughtException: (error: Error) => {
			// Assuming client.postInitError is async now
			client
				.postInitError(error, () => process.exit(129))
				.catch((err) => {
					console.error('Failed to postInitError for uncaughtException', err);
					process.exit(129); // Exit even if posting fails
				});
		},
		unhandledRejection: (error: Error) => {
			// Assuming client.postInitError is async now
			client
				.postInitError(error, () => process.exit(128))
				.catch((err) => {
					console.error('Failed to postInitError for unhandledRejection', err);
					process.exit(128); // Exit even if posting fails
				});
		},
	};

	process.on('uncaughtException', (error: Error) => {
		LogPatch.structuredConsole.logError?.('Uncaught Exception', error);
		errorCallbacks.uncaughtException(error);
	});

	process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
		const error = new Errors.UnhandledPromiseRejection(reason, promise);
		LogPatch.structuredConsole.logError?.('Unhandled Promise Rejection', error);
		errorCallbacks.unhandledRejection(error);
	});

	BeforeExitListener.reset();
	process.on('beforeExit', BeforeExitListener.invoke);

	const handlerFunc: LambdaHandler = UserFunction.isHandlerFunction(
		appRootOrHandler,
	)
		? (appRootOrHandler as LambdaHandler) // Type assertion
		: await UserFunction.load(appRootOrHandler as string, handler);

	const metadata = UserFunction.getHandlerMetadata(handlerFunc);

	// Assuming Runtime constructor and scheduleIteration will be updated for async operations
	// and potentially new client structure.
	// For now, instantiating as is. Runtime.js is the next major refactor.
	new Runtime(
		client,
		handlerFunc,
		metadata,
		errorCallbacks,
	).scheduleIteration();
}

// If this script is the entry point (i.e., not imported as a module), start the runtime.
// This allows `bun src/index.ts` or `bun dist/index.js` to run the RIC.
// Enhanced to work as both module and executable (bin script functionality)
if (import.meta.main) {
	console.log('RIC_DEBUG: import.meta.main is true');

	// Import logger for structured logging when used as executable
	const { log } = require('./Logger.js');

	// Check if handler is provided as command line argument (bin script mode)
	if (process.argv.length >= 3) {
		// Bin script mode: handler provided as command line argument
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

		// Use async IIFE for bin script mode
		(async () => {
			try {
				await run(appRoot, handler);
			} catch (error) {
				console.error('Fatal error in executable mode:', error);
				process.exit(1);
			}
		})();
	} else {
		// Traditional RIC mode: handler from environment variables
		const appRoot = process.env.LAMBDA_TASK_ROOT || process.cwd();
		console.log(`RIC_DEBUG: appRoot: ${appRoot}`);
		// _HANDLER is what RIE sets. AWS_LAMBDA_FUNCTION_HANDLER is what SAM CLI local invoke might set.
		const handlerString =
			process.env._HANDLER || process.env.AWS_LAMBDA_FUNCTION_HANDLER || '';
		console.log(`RIC_DEBUG: handlerString: ${handlerString}`);
		console.log(
			`RIC_DEBUG: AWS_LAMBDA_RUNTIME_API: ${process.env.AWS_LAMBDA_RUNTIME_API}`,
		);

		if (!handlerString) {
			console.error('RIC_DEBUG: FATAL: Handler environment variable not set.');
			const err = new Error(
				'FATAL: Handler environment variable (_HANDLER or AWS_LAMBDA_FUNCTION_HANDLER) not set.',
			);
			console.error(err.message);
			process.exit(129);
		}

		// Use an async IIFE to allow awaiting the run() function
		(async () => {
			try {
				await run(appRoot, handlerString);
				verbose('Runtime main execution completed. Exiting.');
			} catch (err) {
				console.error(
					'FATAL: Error during runtime initialization or main loop:',
					err,
				);
				process.exit(1);
			}
		})();
	}
}

export { log, run };
