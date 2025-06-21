/**
 * Object Pool implementation for reducing memory allocations
 * Part of Phase 1: Foundation Optimizations
 */

export interface Poolable {
	reset(): void;
}

export class ObjectPool<T extends Poolable> {
	private pool: T[] = [];
	private factory: () => T;
	private maxSize: number;
	private created = 0;
	private acquired = 0;
	private released = 0;

	constructor(factory: () => T, maxSize = 50) {
		this.factory = factory;
		this.maxSize = maxSize;
	}

	/**
	 * Acquire an object from the pool or create a new one
	 */
	acquire(): T {
		this.acquired++;
		const obj = this.pool.pop();
		if (obj) {
			return obj;
		}

		this.created++;
		return this.factory();
	}

	/**
	 * Release an object back to the pool
	 */
	release(obj: T): void {
		if (this.pool.length < this.maxSize) {
			obj.reset();
			this.pool.push(obj);
			this.released++;
		}
	}

	/**
	 * Get pool statistics for monitoring
	 */
	getStats() {
		return {
			poolSize: this.pool.length,
			maxSize: this.maxSize,
			created: this.created,
			acquired: this.acquired,
			released: this.released,
			hitRate:
				this.acquired > 0 ? (this.acquired - this.created) / this.acquired : 0,
		};
	}

	/**
	 * Clear the pool (useful for testing)
	 */
	clear(): void {
		this.pool.length = 0;
		this.created = 0;
		this.acquired = 0;
		this.released = 0;
	}
}

/**
 * Simple buffer pool for streaming operations
 */
export class BufferPool {
	private buffers: ArrayBuffer[] = [];
	private bufferSize: number;
	private maxBuffers: number;

	constructor(bufferSize = 65536, maxBuffers = 10) {
		// 64KB default
		this.bufferSize = bufferSize;
		this.maxBuffers = maxBuffers;
	}

	acquire(): ArrayBuffer {
		return this.buffers.pop() || new ArrayBuffer(this.bufferSize);
	}

	release(buffer: ArrayBuffer): void {
		if (
			buffer.byteLength === this.bufferSize &&
			this.buffers.length < this.maxBuffers
		) {
			this.buffers.push(buffer);
		}
	}

	clear(): void {
		this.buffers.length = 0;
	}

	/**
	 * Get the number of available buffers
	 */
	get availableCount(): number {
		return this.buffers.length;
	}
}
