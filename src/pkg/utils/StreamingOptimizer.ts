/**
 * Streaming Architecture Optimization
 * Part of Phase 3: Architectural Refinements
 */

import { globalAdvancedBufferPool } from './AdvancedBufferPool';

/**
 * Adaptive chunking strategy based on content analysis
 */
export enum ChunkingStrategy {
	SMALL = 'small', // 1-4KB - for JSON/structured data
	MEDIUM = 'medium', // 8-16KB - for text content
	LARGE = 'large', // 32-64KB - for binary/media
	ADAPTIVE = 'adaptive', // Dynamic based on content analysis
}

/**
 * Content type analysis for optimal chunking
 */
export interface ContentAnalysis {
	contentType: string;
	estimatedSize: number;
	isStructured: boolean;
	isCompressible: boolean;
	recommendedStrategy: ChunkingStrategy;
	optimalChunkSize: number;
}

/**
 * Backpressure monitoring and control
 */
export interface BackpressureMetrics {
	queueSize: number;
	processingRate: number; // chunks per second
	averageChunkSize: number;
	bufferUtilization: number; // 0-1
	isBackpressured: boolean;
	recommendedAction: 'continue' | 'throttle' | 'pause';
}

/**
 * Streaming performance statistics
 */
export interface StreamingStats {
	totalChunks: number;
	totalBytes: number;
	averageChunkSize: number;
	throughputBytesPerSecond: number;
	adaptiveAdjustments: number;
	backpressureEvents: number;
	errorRecoveries: number;
	startTime: number;
	lastUpdateTime: number;
}

/**
 * Advanced streaming optimizer with adaptive chunking and backpressure handling
 */
export class StreamingOptimizer {
	private stats: StreamingStats;
	private chunkQueue: ArrayBuffer[] = [];
	private processingQueue: Promise<void>[] = [];
	private maxQueueSize: number;
	private targetThroughput: number; // bytes per second
	private adaptiveThreshold: number = 0.8; // backpressure threshold

	constructor(
		maxQueueSize: number = 100,
		targetThroughput: number = 10 * 1024 * 1024, // 10MB/s default
	) {
		this.maxQueueSize = maxQueueSize;
		this.targetThroughput = targetThroughput;
		this.stats = this.initializeStats();
	}

	private initializeStats(): StreamingStats {
		const now = performance.now();
		return {
			totalChunks: 0,
			totalBytes: 0,
			averageChunkSize: 0,
			throughputBytesPerSecond: 0,
			adaptiveAdjustments: 0,
			backpressureEvents: 0,
			errorRecoveries: 0,
			startTime: now,
			lastUpdateTime: now,
		};
	}

	/**
	 * Analyze content to determine optimal chunking strategy
	 */
	analyzeContent(
		contentType?: string,
		estimatedSize?: number,
		sampleData?: ArrayBuffer,
	): ContentAnalysis {
		const type = contentType?.toLowerCase() || 'application/octet-stream';
		const size = estimatedSize || 0;

		// Analyze content type
		const isStructured =
			type.includes('json') || type.includes('xml') || type.includes('text');
		const isCompressible =
			isStructured || type.includes('text') || type.includes('html');

		// Determine strategy based on content analysis
		let strategy: ChunkingStrategy;
		let optimalChunkSize: number;

		if (type.includes('json') || type.includes('xml')) {
			strategy = ChunkingStrategy.SMALL;
			optimalChunkSize = 4 * 1024; // 4KB for structured data
		} else if (type.includes('text') || type.includes('html')) {
			strategy = ChunkingStrategy.MEDIUM;
			optimalChunkSize = 16 * 1024; // 16KB for text
		} else if (
			type.includes('image') ||
			type.includes('video') ||
			type.includes('audio')
		) {
			strategy = ChunkingStrategy.LARGE;
			optimalChunkSize = 64 * 1024; // 64KB for media
		} else {
			strategy = ChunkingStrategy.ADAPTIVE;
			// Adaptive sizing based on estimated size
			if (size < 10 * 1024) {
				optimalChunkSize = 1 * 1024; // 1KB for small content
			} else if (size < 100 * 1024) {
				optimalChunkSize = 8 * 1024; // 8KB for medium content
			} else {
				optimalChunkSize = 32 * 1024; // 32KB for large content
			}
		}

		// Analyze sample data if provided
		if (sampleData && sampleData.byteLength > 0) {
			const entropy = this.calculateEntropy(sampleData);
			if (entropy > 0.8) {
				// High entropy suggests binary/compressed data
				optimalChunkSize = Math.max(optimalChunkSize, 32 * 1024);
			}
		}

		return {
			contentType: type,
			estimatedSize: size,
			isStructured,
			isCompressible,
			recommendedStrategy: strategy,
			optimalChunkSize,
		};
	}

	/**
	 * Calculate entropy of data sample for compression analysis
	 */
	private calculateEntropy(data: ArrayBuffer): number {
		const bytes = new Uint8Array(data);
		const frequency = new Array(256).fill(0);

		// Count byte frequencies
		for (let i = 0; i < bytes.length; i++) {
			const byteValue = bytes[i];
			if (byteValue !== undefined) {
				frequency[byteValue]++;
			}
		}

		// Calculate entropy
		let entropy = 0;
		const length = bytes.length;

		for (let i = 0; i < 256; i++) {
			if (frequency[i] > 0) {
				const p = frequency[i] / length;
				entropy -= p * Math.log2(p);
			}
		}

		return entropy / 8; // Normalize to 0-1 range
	}

	/**
	 * Create optimized chunks from input data
	 */
	createOptimizedChunks(
		data: ArrayBuffer,
		analysis: ContentAnalysis,
		maxChunkSize?: number,
	): ArrayBuffer[] {
		const chunkSize = Math.min(
			analysis.optimalChunkSize,
			maxChunkSize || analysis.optimalChunkSize,
		);

		const chunks: ArrayBuffer[] = [];
		const dataView = new Uint8Array(data);

		for (let offset = 0; offset < dataView.length; offset += chunkSize) {
			const remainingBytes = Math.min(chunkSize, dataView.length - offset);
			const chunk = globalAdvancedBufferPool.acquire(remainingBytes);
			const chunkView = new Uint8Array(chunk, 0, remainingBytes);

			chunkView.set(dataView.subarray(offset, offset + remainingBytes));
			chunks.push(chunk.slice(0, remainingBytes));

			// Return buffer to pool
			globalAdvancedBufferPool.release(chunk);
		}

		this.updateStats(chunks);
		return chunks;
	}

	/**
	 * Monitor backpressure and provide recommendations
	 */
	monitorBackpressure(): BackpressureMetrics {
		const now = performance.now();
		const timeDelta = (now - this.stats.lastUpdateTime) / 1000; // seconds

		const queueSize = this.chunkQueue.length;
		const processingRate =
			timeDelta > 0 ? this.stats.totalChunks / timeDelta : 0;
		const bufferUtilization = queueSize / this.maxQueueSize;

		const isBackpressured = bufferUtilization > this.adaptiveThreshold;

		let recommendedAction: 'continue' | 'throttle' | 'pause';
		if (bufferUtilization < 0.5) {
			recommendedAction = 'continue';
		} else if (bufferUtilization < 0.8) {
			recommendedAction = 'throttle';
		} else {
			recommendedAction = 'pause';
		}

		if (isBackpressured) {
			this.stats.backpressureEvents++;
		}

		return {
			queueSize,
			processingRate,
			averageChunkSize: this.stats.averageChunkSize,
			bufferUtilization,
			isBackpressured,
			recommendedAction,
		};
	}

	/**
	 * Adaptive chunk size adjustment based on performance
	 */
	adaptChunkSize(
		currentChunkSize: number,
		metrics: BackpressureMetrics,
	): number {
		let newChunkSize = currentChunkSize;

		if (metrics.isBackpressured) {
			// Reduce chunk size to improve responsiveness
			newChunkSize = Math.max(1024, Math.floor(currentChunkSize * 0.8));
			this.stats.adaptiveAdjustments++;
		} else if (metrics.bufferUtilization < 0.3 && metrics.processingRate > 0) {
			// Increase chunk size for better throughput
			newChunkSize = Math.min(64 * 1024, Math.floor(currentChunkSize * 1.2));
			this.stats.adaptiveAdjustments++;
		}

		return newChunkSize;
	}

	/**
	 * Process streaming data with adaptive optimization
	 */
	async processStream(
		inputStream: ReadableStream<Uint8Array>,
		outputStream: WritableStream<Uint8Array>,
		contentAnalysis: ContentAnalysis,
	): Promise<void> {
		const reader = inputStream.getReader();
		const writer = outputStream.getWriter();

		let currentChunkSize = contentAnalysis.optimalChunkSize;
		let buffer = new Uint8Array(0);

		try {
			while (true) {
				const { done, value } = await reader.read();

				if (done) {
					// Process remaining buffer
					if (buffer.length > 0) {
						await writer.write(buffer);
						this.updateStatsForChunk(buffer.buffer);
					}
					break;
				}

				// Append new data to buffer
				const newBuffer = new Uint8Array(buffer.length + value.length);
				newBuffer.set(buffer);
				newBuffer.set(value, buffer.length);
				buffer = newBuffer;

				// Process complete chunks
				while (buffer.length >= currentChunkSize) {
					const chunk = buffer.slice(0, currentChunkSize);
					await writer.write(chunk);

					this.updateStatsForChunk(chunk.buffer);
					buffer = buffer.slice(currentChunkSize);

					// Check backpressure and adapt
					const metrics = this.monitorBackpressure();
					if (metrics.recommendedAction === 'pause') {
						await this.waitForBackpressureRelief();
					} else if (metrics.recommendedAction === 'throttle') {
						await new Promise((resolve) => setTimeout(resolve, 10));
					}

					// Adapt chunk size based on performance
					currentChunkSize = this.adaptChunkSize(currentChunkSize, metrics);
				}
			}
		} finally {
			reader.releaseLock();
			writer.releaseLock();
		}
	}

	/**
	 * Wait for backpressure to be relieved
	 */
	private async waitForBackpressureRelief(): Promise<void> {
		return new Promise((resolve) => {
			const checkBackpressure = () => {
				const metrics = this.monitorBackpressure();
				if (metrics.bufferUtilization < 0.5) {
					resolve();
				} else {
					setTimeout(checkBackpressure, 50);
				}
			};
			checkBackpressure();
		});
	}

	/**
	 * Update statistics for processed chunks
	 */
	private updateStats(chunks: ArrayBuffer[]): void {
		const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
		this.stats.totalChunks += chunks.length;
		this.stats.totalBytes += totalBytes;
		this.stats.averageChunkSize =
			this.stats.totalBytes / this.stats.totalChunks;

		const now = performance.now();
		const timeDelta = (now - this.stats.startTime) / 1000; // seconds
		this.stats.throughputBytesPerSecond =
			timeDelta > 0 ? this.stats.totalBytes / timeDelta : 0;
		this.stats.lastUpdateTime = now;
	}

	/**
	 * Update statistics for a single chunk
	 */
	private updateStatsForChunk(chunk: ArrayBuffer): void {
		this.stats.totalChunks++;
		this.stats.totalBytes += chunk.byteLength;
		this.stats.averageChunkSize =
			this.stats.totalBytes / this.stats.totalChunks;

		const now = performance.now();
		const timeDelta = (now - this.stats.startTime) / 1000; // seconds
		this.stats.throughputBytesPerSecond =
			timeDelta > 0 ? this.stats.totalBytes / timeDelta : 0;
		this.stats.lastUpdateTime = now;
	}

	/**
	 * Get comprehensive streaming statistics
	 */
	getStats(): StreamingStats {
		return { ...this.stats };
	}

	/**
	 * Reset statistics
	 */
	resetStats(): void {
		this.stats = this.initializeStats();
	}

	/**
	 * Clean up resources
	 */
	cleanup(): void {
		this.chunkQueue.length = 0;
		this.processingQueue.length = 0;
		this.resetStats();
	}
}

/**
 * Global streaming optimizer instance
 */
export const globalStreamingOptimizer = new StreamingOptimizer();

/**
 * Utility functions for streaming optimization
 */
export class StreamingUtils {
	/**
	 * Create an optimized transform stream
	 */
	static createOptimizedTransform(
		contentAnalysis: ContentAnalysis,
		optimizer: StreamingOptimizer = globalStreamingOptimizer,
	): TransformStream<Uint8Array, Uint8Array> {
		let buffer = new Uint8Array(0);
		let currentChunkSize = contentAnalysis.optimalChunkSize;

		return new TransformStream({
			transform(chunk, controller) {
				// Append new data to buffer
				const newBuffer = new Uint8Array(buffer.length + chunk.length);
				newBuffer.set(buffer);
				newBuffer.set(chunk, buffer.length);
				buffer = newBuffer;

				// Process complete chunks
				while (buffer.length >= currentChunkSize) {
					const outputChunk = buffer.slice(0, currentChunkSize);
					controller.enqueue(outputChunk);
					buffer = buffer.slice(currentChunkSize);

					// Adapt chunk size based on backpressure
					const metrics = optimizer.monitorBackpressure();
					currentChunkSize = optimizer.adaptChunkSize(
						currentChunkSize,
						metrics,
					);
				}
			},

			flush(controller) {
				// Output remaining buffer
				if (buffer.length > 0) {
					controller.enqueue(buffer);
				}
			},
		});
	}

	/**
	 * Estimate optimal buffer size for streaming
	 */
	static estimateOptimalBufferSize(
		contentType: string,
		estimatedTotalSize: number,
		targetLatency: number = 100, // ms
	): number {
		const analysis = globalStreamingOptimizer.analyzeContent(
			contentType,
			estimatedTotalSize,
		);

		// Adjust for latency requirements
		let bufferSize = analysis.optimalChunkSize;

		if (targetLatency < 50) {
			// Low latency - smaller buffers
			bufferSize = Math.min(bufferSize, 4 * 1024);
		} else if (targetLatency > 200) {
			// High latency tolerance - larger buffers for throughput
			bufferSize = Math.max(bufferSize, 32 * 1024);
		}

		return bufferSize;
	}

	/**
	 * Create a backpressure-aware readable stream
	 */
	static createBackpressureAwareStream<T>(
		source: AsyncIterable<T>,
		maxBufferSize: number = 100,
	): ReadableStream<T> {
		const buffer: T[] = [];
		let sourceIterator: AsyncIterator<T>;
		let reading = false;

		return new ReadableStream({
			async start() {
				sourceIterator = source[Symbol.asyncIterator]();
			},

			async pull(controller) {
				if (reading) return;
				reading = true;

				try {
					// Fill buffer if needed
					while (buffer.length < maxBufferSize) {
						const { done, value } = await sourceIterator.next();
						if (done) break;
						buffer.push(value);
					}

					// Enqueue from buffer
					if (buffer.length > 0) {
						controller.enqueue(buffer.shift()!);
					} else {
						controller.close();
					}
				} catch (error) {
					controller.error(error);
				} finally {
					reading = false;
				}
			},
		});
	}
}
