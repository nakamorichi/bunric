/**
 * Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *
 * Defines custom error types throwable by the runtime.
 */

import util from 'node:util';

interface RapidErrorResponse {
	errorType: string;
	errorMessage: string;
	trace?: string[];
}

function _isError(obj: any): obj is Error {
	return (
		obj?.name &&
		obj.message &&
		obj.stack &&
		typeof obj.name === 'string' &&
		typeof obj.message === 'string' &&
		typeof obj.stack === 'string'
	);
}

export function intoError(err: any): Error {
	if (err instanceof Error) {
		return err;
	} else {
		return new Error(String(err));
	}
}

/**
 * Attempt to convert an object into a response object.
 * This method accounts for failures when serializing the error object.
 */
export function toRapidResponse(error: any): RapidErrorResponse {
	try {
		if (util.types.isNativeError(error) || _isError(error)) {
			return {
				errorType: error.name?.replace(/\x7F/g, '%7F') || 'Error',
				errorMessage: error.message?.replace(/\x7F/g, '%7F') || '',
				trace: error.stack?.replace(/\x7F/g, '%7F').split('\n'),
			};
		} else {
			return {
				errorType: typeof error,
				errorMessage: String(error), // Ensure errorMessage is a string
				trace: [],
			};
		}
	} catch (_err) {
		return {
			errorType: 'handled',
			errorMessage:
				'callback called with Error argument, but there was a problem while retrieving one or more of its message, name, and stack',
		};
	}
}

/**
 * Error name, message, code, and stack are all members of the superclass, which
 * means they aren't enumerable and don't normally show up in JSON.stringify.
 * This method ensures those interesting properties are available along with any
 * user-provided enumerable properties.
 */
function _withEnumerableProperties(error: any): any {
	if (error instanceof Error) {
		const ret: any = Object.assign(
			{
				errorType: error.name,
				errorMessage: error.message,
				// @ts-ignore // code is not a standard property on Error but often used
				code: error.code,
			},
			error,
		);
		if (typeof error.stack === 'string') {
			ret.stack = error.stack.split('\n');
		}
		return ret;
	} else {
		return error;
	}
}

/**
 * Format an error with the expected properties.
 * For compatability, the error string always starts with a tab.
 */
export const toFormatted = (error: any): string => {
	try {
		return `\t${JSON.stringify(error, (_k, v) => _withEnumerableProperties(v))}`;
	} catch (err) {
		return `\t${JSON.stringify(toRapidResponse(error))}`;
	}
};

export class ImportModuleError extends Error {
	constructor(message?: string) {
		super(message);
		this.name = 'Runtime.ImportModuleError';
	}
}
export class HandlerNotFound extends Error {
	constructor(message?: string) {
		super(message);
		this.name = 'Runtime.HandlerNotFound';
	}
}
export class MalformedHandlerName extends Error {
	constructor(message?: string) {
		super(message);
		this.name = 'Runtime.MalformedHandlerName';
	}
}
export class UserCodeSyntaxError extends Error {
	constructor(originalError?: Error | string) {
		super(
			originalError instanceof Error ? originalError.message : originalError,
		);
		this.name = 'Runtime.UserCodeSyntaxError';
		if (originalError instanceof Error) {
			this.stack = originalError.stack;
		}
	}
}
export class MalformedStreamingHandler extends Error {
	constructor(message?: string) {
		super(message);
		this.name = 'Runtime.MalformedStreamingHandler';
	}
}
export class InvalidStreamingOperation extends Error {
	constructor(message?: string) {
		super(message);
		this.name = 'Runtime.InvalidStreamingOperation';
	}
}
export class UnhandledPromiseRejection extends Error {
	public reason: any;
	public promise: Promise<any>;
	constructor(reason: any, promise: Promise<any>) {
		super(String(reason)); // Ensure message is a string
		this.name = 'Runtime.UnhandledPromiseRejection';
		this.reason = reason;
		this.promise = promise;
	}
}
