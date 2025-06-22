/**
 * Advanced Buffer Pool implementation for streaming operations
 * Part of Phase 2: Core Performance Enhancements
 */

/**
 * Advanced buffer pool with multiple size categories and adaptive management
 */
export class AdvancedBufferPool {
	private pools: Map<number, ArrayBuffer[]> = new Map();
	private maxBuffersPerSize: number;
	private stats: Map<
		number,
		{ allocated: number; reused: number; released: number }
	> = new Map();

	// Standard buffer sizes for different use cases
	private readonly BUFFER_SIZES = [
		1024, // 1KB - small chunks
		4096, // 4KB - medium chunks
		8192, // 8KB - standard chunks
		16384, // 16KB - large chunks
		32768, // 32KB - very large chunks
		65536, // 64KB - streaming chunks
	];

	constructor(maxBuffersPerSize = 10) {
		this.maxBuffersPerSize = maxBuffersPerSize;

		// Initialize pools and stats for each buffer size
		for (const size of this.BUFFER_SIZES) {
			this.pools.set(size, []);
			this.stats.set(size, { allocated: 0, reused: 0, released: 0 });
		}
	}

	/**
	 * Get the optimal buffer size for the requested size
	 */
	private getOptimalSize(requestedSize: number): number {
		// Find the smallest buffer size that can accommodate the request
		for (const size of this.BUFFER_SIZES) {
			if (size >= requestedSize) {
				return size;
			}
		}
		// If requested size is larger than our largest buffer, return the requested size
		return requestedSize;
	}

	/**
	 * Acquire a buffer of at least the specified size
	 */
	acquire(minSize: number): ArrayBuffer {
		const optimalSize = this.getOptimalSize(minSize);
		const pool = this.pools.get(optimalSize);
		const stats = this.stats.get(optimalSize);

		if (pool && pool.length > 0) {
			// Reuse existing buffer
			const buffer = pool.pop()!;
			if (stats) {
				stats.reused++;
			}
			return buffer;
		}

		// Create new buffer
		const buffer = new ArrayBuffer(optimalSize);
		if (stats) {
			stats.allocated++;
		} else {
			// For non-standard sizes, create stats entry
			this.stats.set(optimalSize, { allocated: 1, reused: 0, released: 0 });
		}

		return buffer;
	}

	/**
	 * Release a buffer back to the pool
	 */
	release(buffer: ArrayBuffer): void {
		const size = buffer.byteLength;
		let pool = this.pools.get(size);

		if (!pool) {
			// Create pool for this size if it doesn't exist
			pool = [];
			this.pools.set(size, pool);
		}

		// Only keep buffer if pool isn't full
		if (pool.length < this.maxBuffersPerSize) {
			pool.push(buffer);

			const stats = this.stats.get(size);
			if (stats) {
				stats.released++;
			} else {
				this.stats.set(size, { allocated: 0, reused: 0, released: 1 });
			}
		}
	}

	/**
	 * Get comprehensive statistics for all buffer sizes
	 */
	getStats() {
		const result: Record<string, any> = {};

		for (const [size, stats] of this.stats.entries()) {
			const pool = this.pools.get(size);
			const available = pool ? pool.length : 0;

			result[`${size}B`] = {
				size,
				available,
				allocated: stats.allocated,
				reused: stats.reused,
				released: stats.released,
				hitRate:
					stats.allocated > 0
						? stats.reused / (stats.allocated + stats.reused)
						: 0,
				efficiency: stats.released > 0 ? available / stats.released : 0,
			};
		}

		return result;
	}

	/**
	 * Clear all pools
	 */
	clear(): void {
		for (const pool of this.pools.values()) {
			pool.length = 0;
		}

		for (const stats of this.stats.values()) {
			stats.allocated = 0;
			stats.reused = 0;
			stats.released = 0;
		}
	}

	/**
	 * Get total memory usage of all pools
	 */
	getTotalMemoryUsage(): number {
		let total = 0;
		for (const [size, pool] of this.pools.entries()) {
			total += size * pool.length;
		}
		return total;
	}

	/**
	 * Trim pools to reduce memory usage (remove excess buffers)
	 */
	trim(targetUtilization = 0.5): void {
		for (const [size, pool] of this.pools.entries()) {
			const stats = this.stats.get(size);
			if (stats && stats.reused > 0) {
				// Calculate optimal pool size based on usage patterns
				const optimalSize = Math.ceil(stats.reused * targetUtilization);
				const maxSize = Math.min(optimalSize, this.maxBuffersPerSize);

				if (pool.length > maxSize) {
					pool.splice(maxSize);
				}
			}
		}
	}
}

/**
 * Specialized buffer pool for streaming operations with adaptive chunking
 */
export class StreamingBufferPool extends AdvancedBufferPool {
	private chunkSizeHistory: number[] = [];
	private readonly HISTORY_SIZE = 100;

	constructor(maxBuffersPerSize = 15) {
		super(maxBuffersPerSize);
	}

	/**
	 * Acquire buffer with adaptive sizing based on streaming patterns
	 */
	acquireForStreaming(
		contentType?: string,
		estimatedSize?: number,
	): ArrayBuffer {
		const optimalSize = this.getAdaptiveChunkSize(contentType, estimatedSize);

		// Record this size for future adaptation
		this.recordChunkSize(optimalSize);

		return this.acquire(optimalSize);
	}

	/**
	 * Get adaptive chunk size based on content type and history
	 */
	private getAdaptiveChunkSize(
		contentType?: string,
		estimatedSize?: number,
	): number {
		// Base size on content type
		let baseSize = 8192; // 8KB default

		if (contentType) {
			if (contentType.includes('json')) {
				baseSize = 4096; // 4KB for JSON
			} else if (contentType.includes('text')) {
				baseSize = 16384; // 16KB for text
			} else if (
				contentType.includes('binary') ||
				contentType.includes('octet-stream')
			) {
				baseSize = 65536; // 64KB for binary
			}
		}

		// Adjust based on estimated size
		if (estimatedSize) {
			if (estimatedSize < 1024) {
				baseSize = 1024;
			} else if (estimatedSize < 4096) {
				baseSize = 4096;
			} else if (estimatedSize > 32768) {
				baseSize = 65536;
			}
		}

		// Adjust based on historical patterns
		if (this.chunkSizeHistory.length > 10) {
			const avgHistoricalSize =
				this.chunkSizeHistory.reduce((a, b) => a + b, 0) /
				this.chunkSizeHistory.length;
			// Blend historical average with base size
			baseSize = Math.round((baseSize + avgHistoricalSize) / 2);
		}

		return baseSize;
	}

	/**
	 * Record chunk size for adaptive learning
	 */
	private recordChunkSize(size: number): void {
		this.chunkSizeHistory.push(size);

		if (this.chunkSizeHistory.length > this.HISTORY_SIZE) {
			this.chunkSizeHistory.shift();
		}
	}

	/**
	 * Get streaming-specific statistics
	 */
	getStreamingStats() {
		const baseStats = this.getStats();

		return {
			...baseStats,
			adaptiveStats: {
				historicalChunks: this.chunkSizeHistory.length,
				averageChunkSize:
					this.chunkSizeHistory.length > 0
						? this.chunkSizeHistory.reduce((a, b) => a + b, 0) /
							this.chunkSizeHistory.length
						: 0,
				chunkSizeVariance: this.calculateVariance(),
				totalMemoryUsage: this.getTotalMemoryUsage(),
			},
		};
	}

	/**
	 * Calculate variance in chunk sizes for adaptation quality metrics
	 */
	private calculateVariance(): number {
		if (this.chunkSizeHistory.length < 2) return 0;

		const mean =
			this.chunkSizeHistory.reduce((a, b) => a + b, 0) /
			this.chunkSizeHistory.length;
		const squaredDiffs = this.chunkSizeHistory.map(
			(size) => (size - mean) ** 2,
		);
		return (
			squaredDiffs.reduce((a, b) => a + b, 0) / this.chunkSizeHistory.length
		);
	}
}

/**
 * Global advanced buffer pool instance
 */
export const globalAdvancedBufferPool = new AdvancedBufferPool(12);

/**
 * Global streaming buffer pool instance
 */
export const globalStreamingBufferPool = new StreamingBufferPool(15);

/**
 * Utility functions for common buffer operations
 */
export class BufferUtils {
	/**
	 * Copy data between buffers efficiently
	 */
	static copyBuffer(
		source: ArrayBuffer,
		target: ArrayBuffer,
		sourceOffset = 0,
		targetOffset = 0,
		length?: number,
	): void {
		const copyLength =
			length ??
			Math.min(
				source.byteLength - sourceOffset,
				target.byteLength - targetOffset,
			);
		const sourceView = new Uint8Array(source, sourceOffset, copyLength);
		const targetView = new Uint8Array(target, targetOffset, copyLength);
		targetView.set(sourceView);
	}

	/**
	 * Concatenate multiple buffers into one
	 */
	static concatenateBuffers(buffers: ArrayBuffer[]): ArrayBuffer {
		const totalLength = buffers.reduce(
			(sum, buffer) => sum + buffer.byteLength,
			0,
		);
		const result = globalAdvancedBufferPool.acquire(totalLength);

		let offset = 0;
		for (const buffer of buffers) {
			BufferUtils.copyBuffer(buffer, result, 0, offset);
			offset += buffer.byteLength;
		}

		return result;
	}

	/**
	 * Split a buffer into chunks of specified size
	 */
	static splitBuffer(buffer: ArrayBuffer, chunkSize: number): ArrayBuffer[] {
		const chunks: ArrayBuffer[] = [];
		let offset = 0;

		while (offset < buffer.byteLength) {
			const remainingBytes = buffer.byteLength - offset;
			const currentChunkSize = Math.min(chunkSize, remainingBytes);
			const chunk = globalAdvancedBufferPool.acquire(currentChunkSize);

			BufferUtils.copyBuffer(buffer, chunk, offset, 0, currentChunkSize);
			chunks.push(chunk);
			offset += currentChunkSize;
		}

		return chunks;
	}

	/**
	 * Release multiple buffers back to pools
	 */
	static releaseBuffers(buffers: ArrayBuffer[]): void {
		for (const buffer of buffers) {
			globalAdvancedBufferPool.release(buffer);
		}
	}
}
