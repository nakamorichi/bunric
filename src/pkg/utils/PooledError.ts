/**
 * Pooled Error implementation for reducing memory allocations
 * Part of Phase 1: Foundation Optimizations
 */

import type { Poolable } from './ObjectPool.ts';

/**
 * A poolable error class that can be reused to reduce allocations
 */
export class PooledError extends Error implements Poolable {
	private _name: string = 'Error';
	private _message: string = '';
	private _stack?: string;
	private _cause?: unknown;

	constructor(message?: string, name?: string) {
		super(message);
		this._name = name || 'Error';
		this._message = message || '';
		this.name = this._name;
		this.message = this._message;
	}

	/**
	 * Initialize the error with new values (for object pooling)
	 */
	initialize(message: string, name?: string, cause?: unknown): void {
		this._name = name || 'Error';
		this._message = message;
		this._cause = cause;
		this.name = this._name;
		this.message = this._message;
		this.cause = cause;

		// Capture stack trace
		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, PooledError);
		} else {
			this._stack = new Error().stack;
			this.stack = this._stack;
		}
	}

	/**
	 * Reset the error for object pooling
	 */
	reset(): void {
		this._name = 'Error';
		this._message = '';
		this._stack = undefined;
		this._cause = undefined;
		this.name = this._name;
		this.message = this._message;
		this.stack = undefined;
		this.cause = undefined;
	}

	/**
	 * Create a standard Error from this pooled error
	 */
	toStandardError(): Error {
		const error = new Error(this._message);
		error.name = this._name;
		error.stack = this._stack || this.stack;
		if (this._cause !== undefined) {
			error.cause = this._cause;
		}
		return error;
	}
}

/**
 * Pooled versions of common Lambda runtime errors
 */
export class PooledImportModuleError extends PooledError {
	constructor(message?: string) {
		super(message, 'Runtime.ImportModuleError');
	}

	override initialize(message: string): void {
		super.initialize(message, 'Runtime.ImportModuleError');
	}
}

export class PooledHandlerNotFound extends PooledError {
	constructor(message?: string) {
		super(message, 'Runtime.HandlerNotFound');
	}

	override initialize(message: string): void {
		super.initialize(message, 'Runtime.HandlerNotFound');
	}
}

export class PooledMalformedHandlerName extends PooledError {
	constructor(message?: string) {
		super(message, 'Runtime.MalformedHandlerName');
	}

	override initialize(message: string): void {
		super.initialize(message, 'Runtime.MalformedHandlerName');
	}
}

export class PooledUserCodeSyntaxError extends PooledError {
	constructor(originalError?: Error | string) {
		const message =
			originalError instanceof Error ? originalError.message : originalError;
		super(message, 'Runtime.UserCodeSyntaxError');
		if (originalError instanceof Error) {
			this.stack = originalError.stack;
		}
	}

	initializeWithError(originalError: Error | string): void {
		const message =
			originalError instanceof Error ? originalError.message : originalError;
		super.initialize(message, 'Runtime.UserCodeSyntaxError');
		if (originalError instanceof Error) {
			this.stack = originalError.stack;
		}
	}
}

export class PooledUnhandledPromiseRejection extends PooledError {
	public reason: any;
	public promise: Promise<any> | null = null;

	constructor(reason?: any, promise?: Promise<any>) {
		super(String(reason), 'Runtime.UnhandledPromiseRejection');
		this.reason = reason;
		this.promise = promise || null;
	}

	initializeWithRejection(reason: any, promise?: Promise<any>): void {
		super.initialize(String(reason), 'Runtime.UnhandledPromiseRejection');
		this.reason = reason;
		this.promise = promise || null;
	}

	override reset(): void {
		super.reset();
		this.reason = undefined;
		this.promise = null;
	}
}
