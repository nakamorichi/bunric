/**
 * Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *
 * This module defines the functions for loading the user's code as specified
 * in a handler string.
 */

import path from 'node:path';

// import fs from 'fs'; // fs usage will be minimized or removed if Bun's resolver handles all cases
import {
	HandlerNotFound,
	ImportModuleError,
	MalformedHandlerName,
	MalformedStreamingHandler, // Added missing import
	UserCodeSyntaxError,
} from './Errors.ts';
import { HttpResponseStream } from './HttpResponseStream.ts';
import { verbose } from './VerboseLog.ts';

const FUNCTION_EXPR = /^([^.]*)\.(.*)$/;
const RELATIVE_PATH_SUBSTRING = '..';
const HANDLER_STREAMING = Symbol.for('aws.lambda.runtime.handler.streaming');
const HANDLER_HIGHWATERMARK = Symbol.for(
	'aws.lambda.runtime.handler.streaming.highWaterMark',
);
const STREAM_RESPONSE = 'response';

const NoGlobalAwsLambda =
	process.env.AWS_LAMBDA_NODEJS_NO_GLOBAL_AWSLAMBDA === '1' ||
	process.env.AWS_LAMBDA_NODEJS_NO_GLOBAL_AWSLAMBDA === 'true';

function _moduleRootAndHandler(fullHandlerString: string): [string, string] {
	try {
		verbose('_moduleRootAndHandler input:', fullHandlerString);
		const handlerString = path.basename(fullHandlerString);
		const moduleRoot = fullHandlerString.substring(
			0,
			fullHandlerString.indexOf(handlerString),
		);
		const result: [string, string] = [moduleRoot, handlerString];
		verbose('_moduleRootAndHandler result:', result);
		return result;
	} catch (error) {
		verbose('Error in _moduleRootAndHandler:', error);
		throw new MalformedHandlerName(
			`Failed to parse handler path: ${fullHandlerString}`,
		);
	}
}

function _splitHandlerString(handler: string): [string, string] {
	try {
		verbose('_splitHandlerString input:', handler);
		const match = handler.match(FUNCTION_EXPR);
		verbose('Regex match result:', match);
		if (!match || match.length !== 3) {
			throw new MalformedHandlerName(`Bad handler: ${handler}`);
		}
		const result: [string, string] = [match[1]!, match[2]!]; // [module, function-path] - Asserting match groups exist
		verbose('_splitHandlerString result:', result);
		return result;
	} catch (error) {
		verbose('Error in _splitHandlerString:', error);
		throw new MalformedHandlerName(
			`Failed to parse handler string: ${handler}`,
		);
	}
}

function _resolveHandler(
	object: Record<string, any> | any,
	nestedProperty: string,
): any {
	return nestedProperty.split('.').reduce((nested: any, key: string) => {
		return nested?.[key];
	}, object);
}

/**
 * Attempt to load the user's module using Bun's import.
 * Bun's import can handle .js, .ts, .mjs, .cjs and respects package.json "type".
 * This function handles both regular execution and bytecode execution contexts.
 */
async function _tryImport(
	appRoot: string,
	moduleRoot: string,
	moduleName: string,
): Promise<any> {
	// Construct the path similar to how Lambda resolves it.
	// moduleName is usually something like 'index' or 'myModule' (without extension)
	// Bun's resolver will attempt to find .js, .ts, etc.
	const absoluteModulePath = path.resolve(appRoot, moduleRoot, moduleName);
	verbose('Attempting to import module:', absoluteModulePath);

	// Detect if we're running from bytecode - bytecode changes import resolution context
	const isFromBytecode =
		process.isBun &&
		(!!process.execPath?.includes('.bun') ||
			!!process.argv[0]?.includes('bunric') ||
			process.env._BUN_BYTECODE === '1');

	verbose('Bytecode execution detected:', isFromBytecode);

	try {
		if (isFromBytecode) {
			// When running from bytecode, first try standard import, then file:// protocol
			verbose('Using bytecode-compatible import strategies');
			try {
				// First try standard import - sometimes works even in bytecode
				verbose('Trying standard import first in bytecode context');
				const userModule = await import(absoluteModulePath);
				verbose('Standard import succeeded in bytecode context');
				if (userModule && typeof userModule === 'object') {
					return userModule;
				}
				verbose(
					'Standard import returned invalid module, trying file protocol',
				);
			} catch (standardImportError) {
				const error =
					standardImportError instanceof Error
						? standardImportError
						: new Error(String(standardImportError));
				verbose('Standard import failed in bytecode context:', error.message);
			}

			try {
				// Try file:// protocol with absolute path
				const fileUrl = `file://${absoluteModulePath}`;
				verbose('Trying file protocol import:', fileUrl);
				const userModule = await import(fileUrl);
				verbose('File protocol import succeeded');
				if (userModule && typeof userModule === 'object') {
					return userModule;
				}
				verbose('File protocol import returned invalid module');
			} catch (fileImportError) {
				const error =
					fileImportError instanceof Error
						? fileImportError
						: new Error(String(fileImportError));
				verbose('File protocol import failed:', error.message);
			}

			try {
				// Fallback: use require.resolve + file:// protocol
				verbose('Trying require.resolve approach');
				const nodeStylePath = require.resolve(moduleName, {
					paths: [path.resolve(appRoot, moduleRoot), appRoot],
				});
				verbose('Resolved with require.resolve to:', nodeStylePath);
				const fileUrl = `file://${nodeStylePath}`;
				const userModule = await import(fileUrl);
				verbose('require.resolve + file protocol succeeded');
				if (userModule && typeof userModule === 'object') {
					return userModule;
				}
				verbose('require.resolve + file protocol returned invalid module');
			} catch (resolveImportError) {
				const error =
					resolveImportError instanceof Error
						? resolveImportError
						: new Error(String(resolveImportError));
				verbose('require.resolve + file protocol failed:', error.message);
			}

			// Final fallback: try require() directly (for CJS modules)
			try {
				verbose('Trying direct require() as final fallback');
				const nodeStylePath = require.resolve(moduleName, {
					paths: [path.resolve(appRoot, moduleRoot), appRoot],
				});
				verbose('Using require() for:', nodeStylePath);
				// Delete from require cache to ensure fresh load
				delete require.cache[nodeStylePath];
				const userModule = require(nodeStylePath);
				verbose('Direct require() succeeded');
				if (userModule && typeof userModule === 'object') {
					return userModule;
				}
				verbose('Direct require() returned invalid module');
			} catch (requireError) {
				const error =
					requireError instanceof Error
						? requireError
						: new Error(String(requireError));
				verbose('Direct require() failed:', error.message);
			}
		} else {
			// Regular execution: use standard dynamic import
			verbose('Using standard dynamic import for source context');
			const userModule = await import(absoluteModulePath);
			verbose('Standard import succeeded in source context');
			if (userModule && typeof userModule === 'object') {
				return userModule;
			}
			verbose('Standard import returned invalid module in source context');
		}

		// If we get here, all import strategies failed
		throw new Error(`All import strategies failed for module: ${moduleName}`);
	} catch (e) {
		verbose(
			'Primary import strategy failed, trying fallback with require.resolve for potential CJS specific cases or node_modules:',
			moduleName,
		);
		// Fallback for cases where 'moduleName' might be a bare specifier
		// that Bun's import() might not resolve from lambdaStylePath as easily as require.resolve
		// or if there are specific CJS behaviors not perfectly mirrored by import() for that path.
		try {
			const nodeStylePath = require.resolve(moduleName, {
				paths: [path.resolve(appRoot, moduleRoot), appRoot],
			});
			verbose('Resolved with require.resolve to:', nodeStylePath);

			if (isFromBytecode) {
				// Use file:// protocol for bytecode context
				const fileUrl = `file://${nodeStylePath}`;
				return await import(fileUrl);
			} else {
				// Use standard import for source context
				return await import(nodeStylePath);
			}
		} catch (resolveError) {
			verbose('require.resolve also failed:', resolveError);
			// If all strategies fail, rethrow the original import error
			// as it's more likely to be relevant to the lambdaStylePath.
			throw e;
		}
	}
}

async function _loadUserApp(
	appRoot: string,
	moduleRoot: string,
	moduleName: string,
): Promise<any> {
	if (!NoGlobalAwsLambda) {
		globalThis.awslambda = {
			streamifyResponse: (handler, options) => {
				handler[HANDLER_STREAMING] = STREAM_RESPONSE;
				if (typeof options?.highWaterMark === 'number') {
					handler[HANDLER_HIGHWATERMARK] = Number.parseInt(
						String(options.highWaterMark),
					);
				}
				return handler;
			},
			HttpResponseStream: HttpResponseStream,
		};
	}

	try {
		return await _tryImport(appRoot, moduleRoot, moduleName);
	} catch (e: unknown) {
		if (e instanceof SyntaxError) {
			throw new UserCodeSyntaxError(e);
		}

		// Coerce e to an Error object if it's not already one, for consistent checking.
		const error = e instanceof Error ? e : new Error(String(e));

		// Check for module not found conditions on the (potentially new) Error object.
		// The 'code' property might not exist on a generic Error, so we cast to any for the check.
		if (
			(error as any).code === 'MODULE_NOT_FOUND' ||
			error.message?.includes('Cannot find module')
		) {
			throw new ImportModuleError(error.message);
		}

		// If it wasn't a SyntaxError or a recognized MODULE_NOT_FOUND error, rethrow the (potentially wrapped) error.
		throw error;
	}
}

function _throwIfInvalidHandler(fullHandlerString: string): void {
	if (fullHandlerString.includes(RELATIVE_PATH_SUBSTRING)) {
		throw new MalformedHandlerName(
			`'${fullHandlerString}' is not a valid handler name. Use absolute paths when specifying root directories in handler names.`,
		);
	}
}

function _isHandlerStreaming(handler: any): false | typeof STREAM_RESPONSE {
	if (
		typeof handler[HANDLER_STREAMING] === 'undefined' ||
		handler[HANDLER_STREAMING] === null ||
		handler[HANDLER_STREAMING] === false
	) {
		return false;
	}

	if (handler[HANDLER_STREAMING] === STREAM_RESPONSE) {
		return STREAM_RESPONSE;
	} else {
		throw new MalformedStreamingHandler(
			// Make sure MalformedStreamingHandler is imported/defined
			'Only response streaming is supported.',
		);
	}
}

function _highWaterMark(handler: any): number | undefined {
	if (
		typeof handler[HANDLER_HIGHWATERMARK] === 'undefined' ||
		handler[HANDLER_HIGHWATERMARK] === null ||
		handler[HANDLER_HIGHWATERMARK] === false
	) {
		return undefined;
	}

	const hwm = Number.parseInt(String(handler[HANDLER_HIGHWATERMARK]));
	return Number.isNaN(hwm) ? undefined : hwm;
}

export async function load(
	appRoot: string,
	fullHandlerString: string,
): Promise<(...args: any[]) => any> {
	try {
		verbose('UserFunction.load called with:', { appRoot, fullHandlerString });
		_throwIfInvalidHandler(fullHandlerString);

		verbose('Parsing handler string...');
		const moduleAndHandlerResult = _moduleRootAndHandler(fullHandlerString);
		if (
			!moduleAndHandlerResult ||
			!Array.isArray(moduleAndHandlerResult) ||
			moduleAndHandlerResult.length !== 2
		) {
			throw new Error(
				`_moduleRootAndHandler returned invalid result: ${JSON.stringify(moduleAndHandlerResult)}`,
			);
		}
		const [moduleRoot, moduleAndHandler] = moduleAndHandlerResult;
		verbose('Parsed paths:', { moduleRoot, moduleAndHandler });

		verbose('Splitting handler string...');
		const handlerPartsResult = _splitHandlerString(moduleAndHandler);
		if (
			!handlerPartsResult ||
			!Array.isArray(handlerPartsResult) ||
			handlerPartsResult.length !== 2
		) {
			throw new Error(
				`_splitHandlerString returned invalid result: ${JSON.stringify(handlerPartsResult)}`,
			);
		}
		const [moduleName, handlerPath] = handlerPartsResult;
		verbose('Parsed handler parts:', { moduleName, handlerPath });

		verbose('Loading user app...');
		const userApp = await _loadUserApp(appRoot, moduleRoot, moduleName);
		verbose('_loadUserApp returned:', {
			userApp: userApp ? 'object' : 'null/undefined',
			keys: userApp ? Object.keys(userApp) : 'none',
			type: typeof userApp,
		});

		if (!userApp || typeof userApp !== 'object') {
			throw new ImportModuleError(
				`Module import returned invalid result: ${typeof userApp}`,
			);
		}

		verbose('Resolving handler function...');
		let handlerFunc = _resolveHandler(userApp, handlerPath);
		verbose('_resolveHandler returned:', {
			handlerFunc: handlerFunc ? 'found' : 'null/undefined',
			type: typeof handlerFunc,
		});

		if (!handlerFunc) {
			throw new HandlerNotFound(
				`${fullHandlerString} is undefined or not exported`,
			);
		}

		// If handlerPath was 'default' and handlerFunc is an object
		// (likely module.exports from a CJS module wrapped by ESM import's default)
		// and that object itself has a 'default' property which is a function,
		// then use that nested default function.
		// This handles `module.exports = { default: () => {} }` when handler is `filename.default`.
		if (
			handlerPath === 'default' &&
			typeof handlerFunc === 'object' &&
			handlerFunc !== null && // Ensure it's not null
			Object.hasOwn(handlerFunc, 'default') && // Check own property
			typeof handlerFunc.default === 'function'
		) {
			verbose('Using nested default function');
			handlerFunc = handlerFunc.default;
		} else if (typeof handlerFunc !== 'function') {
			throw new HandlerNotFound(`${fullHandlerString} is not a function`);
		}

		verbose('Handler function loaded successfully');
		return handlerFunc;
	} catch (error) {
		verbose('Error in UserFunction.load:', error);
		throw error;
	}
}

export function isHandlerFunction(
	value: any,
): value is (...args: any[]) => any {
	return typeof value === 'function';
}

export function getHandlerMetadata(handlerFunc: any): {
	streaming: false | typeof STREAM_RESPONSE;
	highWaterMark: number | undefined;
} {
	return {
		streaming: _isHandlerStreaming(handlerFunc),
		highWaterMark: _highWaterMark(handlerFunc),
	};
}

export const STREAM_RESPONSE_VALUE = STREAM_RESPONSE; // Exporting the const value
// module.exports.STREAM_RESPONSE = STREAM_RESPONSE; // Old CJS export
