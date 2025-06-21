/**
 * Pool Manager for coordinating object pools
 * Part of Phase 1: Foundation Optimizations
 */

import InvokeContext from '../InvokeContext.ts';
import { BufferPool, ObjectPool } from './ObjectPool.ts';
import {
	PooledError,
	PooledHandlerNotFound,
	PooledImportModuleError,
	PooledMalformedHandlerName,
	PooledUnhandledPromiseRejection,
	PooledUserCodeSyntaxError,
} from './PooledError.ts';

/**
 * Global pool manager for all object pools
 */
export class PoolManager {
	private static instance: PoolManager | null = null;

	// Object pools
	private invokeContextPool: ObjectPool<InvokeContext>;
	private errorPool: ObjectPool<PooledError>;
	private importModuleErrorPool: ObjectPool<PooledImportModuleError>;
	private handlerNotFoundPool: ObjectPool<PooledHandlerNotFound>;
	private malformedHandlerNamePool: ObjectPool<PooledMalformedHandlerName>;
	private userCodeSyntaxErrorPool: ObjectPool<PooledUserCodeSyntaxError>;
	private unhandledPromiseRejectionPool: ObjectPool<PooledUnhandledPromiseRejection>;

	// Buffer pools
	private bufferPool: BufferPool;
	private smallBufferPool: BufferPool;

	private constructor() {
		// Initialize object pools
		this.invokeContextPool = new ObjectPool(() => new InvokeContext(), 20);
		this.errorPool = new ObjectPool(() => new PooledError(), 30);
		this.importModuleErrorPool = new ObjectPool(
			() => new PooledImportModuleError(),
			10,
		);
		this.handlerNotFoundPool = new ObjectPool(
			() => new PooledHandlerNotFound(),
			10,
		);
		this.malformedHandlerNamePool = new ObjectPool(
			() => new PooledMalformedHandlerName(),
			10,
		);
		this.userCodeSyntaxErrorPool = new ObjectPool(
			() => new PooledUserCodeSyntaxError(),
			10,
		);
		this.unhandledPromiseRejectionPool = new ObjectPool(
			() => new PooledUnhandledPromiseRejection(),
			10,
		);

		// Initialize buffer pools
		this.bufferPool = new BufferPool(65536, 10); // 64KB buffers
		this.smallBufferPool = new BufferPool(8192, 20); // 8KB buffers
	}

	/**
	 * Get the singleton instance
	 */
	static getInstance(): PoolManager {
		if (!PoolManager.instance) {
			PoolManager.instance = new PoolManager();
		}
		return PoolManager.instance;
	}

	/**
	 * Get an InvokeContext from the pool
	 */
	getInvokeContext(
		headers?: Record<string, string | undefined>,
	): InvokeContext {
		const context = this.invokeContextPool.acquire();
		if (headers) {
			context.initialize(headers);
		}
		return context;
	}

	/**
	 * Return an InvokeContext to the pool
	 */
	releaseInvokeContext(context: InvokeContext): void {
		this.invokeContextPool.release(context);
	}

	/**
	 * Get a generic error from the pool
	 */
	getError(message: string, name?: string): PooledError {
		const error = this.errorPool.acquire();
		error.initialize(message, name);
		return error;
	}

	/**
	 * Return a generic error to the pool
	 */
	releaseError(error: PooledError): void {
		this.errorPool.release(error);
	}

	/**
	 * Get an ImportModuleError from the pool
	 */
	getImportModuleError(message: string): PooledImportModuleError {
		const error = this.importModuleErrorPool.acquire();
		error.initialize(message);
		return error;
	}

	/**
	 * Return an ImportModuleError to the pool
	 */
	releaseImportModuleError(error: PooledImportModuleError): void {
		this.importModuleErrorPool.release(error);
	}

	/**
	 * Get a HandlerNotFound error from the pool
	 */
	getHandlerNotFoundError(message: string): PooledHandlerNotFound {
		const error = this.handlerNotFoundPool.acquire();
		error.initialize(message);
		return error;
	}

	/**
	 * Return a HandlerNotFound error to the pool
	 */
	releaseHandlerNotFoundError(error: PooledHandlerNotFound): void {
		this.handlerNotFoundPool.release(error);
	}

	/**
	 * Get a MalformedHandlerName error from the pool
	 */
	getMalformedHandlerNameError(message: string): PooledMalformedHandlerName {
		const error = this.malformedHandlerNamePool.acquire();
		error.initialize(message);
		return error;
	}

	/**
	 * Return a MalformedHandlerName error to the pool
	 */
	releaseMalformedHandlerNameError(error: PooledMalformedHandlerName): void {
		this.malformedHandlerNamePool.release(error);
	}

	/**
	 * Get a UserCodeSyntaxError from the pool
	 */
	getUserCodeSyntaxError(
		originalError: Error | string,
	): PooledUserCodeSyntaxError {
		const error = this.userCodeSyntaxErrorPool.acquire();
		error.initializeWithError(originalError);
		return error;
	}

	/**
	 * Return a UserCodeSyntaxError to the pool
	 */
	releaseUserCodeSyntaxError(error: PooledUserCodeSyntaxError): void {
		this.userCodeSyntaxErrorPool.release(error);
	}

	/**
	 * Get an UnhandledPromiseRejection from the pool
	 */
	getUnhandledPromiseRejection(
		reason: any,
		promise?: Promise<any>,
	): PooledUnhandledPromiseRejection {
		const error = this.unhandledPromiseRejectionPool.acquire();
		error.initializeWithRejection(reason, promise);
		return error;
	}

	/**
	 * Return an UnhandledPromiseRejection to the pool
	 */
	releaseUnhandledPromiseRejection(
		error: PooledUnhandledPromiseRejection,
	): void {
		this.unhandledPromiseRejectionPool.release(error);
	}

	/**
	 * Get a buffer from the pool
	 */
	getBuffer(size: 'small' | 'large' = 'large'): ArrayBuffer {
		return size === 'small'
			? this.smallBufferPool.acquire()
			: this.bufferPool.acquire();
	}

	/**
	 * Return a buffer to the pool
	 */
	releaseBuffer(buffer: ArrayBuffer): void {
		if (buffer.byteLength === 8192) {
			this.smallBufferPool.release(buffer);
		} else if (buffer.byteLength === 65536) {
			this.bufferPool.release(buffer);
		}
		// Ignore buffers of other sizes
	}

	/**
	 * Get statistics for all pools
	 */
	getStats() {
		return {
			invokeContext: this.invokeContextPool.getStats(),
			error: this.errorPool.getStats(),
			importModuleError: this.importModuleErrorPool.getStats(),
			handlerNotFound: this.handlerNotFoundPool.getStats(),
			malformedHandlerName: this.malformedHandlerNamePool.getStats(),
			userCodeSyntaxError: this.userCodeSyntaxErrorPool.getStats(),
			unhandledPromiseRejection: this.unhandledPromiseRejectionPool.getStats(),
			buffers: {
				large: {
					available: this.bufferPool.availableCount,
					size: 65536,
				},
				small: {
					available: this.smallBufferPool.availableCount,
					size: 8192,
				},
			},
		};
	}

	/**
	 * Clear all pools (useful for testing)
	 */
	clearAll(): void {
		this.invokeContextPool.clear();
		this.errorPool.clear();
		this.importModuleErrorPool.clear();
		this.handlerNotFoundPool.clear();
		this.malformedHandlerNamePool.clear();
		this.userCodeSyntaxErrorPool.clear();
		this.unhandledPromiseRejectionPool.clear();
		this.bufferPool.clear();
		this.smallBufferPool.clear();
	}
}

/**
 * Global pool manager instance
 */
export const poolManager = PoolManager.getInstance();
