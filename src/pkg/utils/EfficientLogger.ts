/**
 * Efficient logging with minimal overhead
 * Part of Phase 1: Foundation Optimizations
 */

export enum LogLevel {
	ERROR = 0,
	WARN = 1,
	INFO = 2,
	DEBUG = 3,
	VERBOSE = 4,
}

type MessageFactory = () => string;

/**
 * Ring buffer for log aggregation
 */
class LogRingBuffer {
	private buffer: string[];
	private size: number;
	private index = 0;
	private count = 0;

	constructor(size = 100) {
		this.size = size;
		this.buffer = new Array(size);
	}

	add(message: string): void {
		this.buffer[this.index] = message;
		this.index = (this.index + 1) % this.size;
		if (this.count < this.size) {
			this.count++;
		}
	}

	getAll(): string[] {
		if (this.count === 0) return [];

		const result: string[] = [];
		const start = this.count < this.size ? 0 : this.index;

		for (let i = 0; i < this.count; i++) {
			const idx = (start + i) % this.size;
			const item = this.buffer[idx];
			if (item !== undefined) {
				result.push(item);
			}
		}

		return result;
	}

	clear(): void {
		this.count = 0;
		this.index = 0;
	}
}

/**
 * Helper function to get log level name
 */
function getLogLevelName(level: LogLevel): string {
	switch (level) {
		case LogLevel.ERROR:
			return 'ERROR';
		case LogLevel.WARN:
			return 'WARN';
		case LogLevel.INFO:
			return 'INFO';
		case LogLevel.DEBUG:
			return 'DEBUG';
		case LogLevel.VERBOSE:
			return 'VERBOSE';
		default:
			return 'UNKNOWN';
	}
}

/**
 * Efficient logger with conditional execution and sampling
 */
export class EfficientLogger {
	private currentLevel: LogLevel;
	private ringBuffer: LogRingBuffer;
	private sampleRate: number;
	private sampleCounter = 0;

	constructor(
		level: LogLevel = LogLevel.INFO,
		bufferSize = 100,
		sampleRate = 1.0,
	) {
		this.currentLevel = level;
		this.ringBuffer = new LogRingBuffer(bufferSize);
		this.sampleRate = sampleRate;
	}

	private shouldLog(level: LogLevel): boolean {
		return level <= this.currentLevel;
	}

	private shouldSample(): boolean {
		if (this.sampleRate >= 1.0) return true;
		this.sampleCounter++;
		return (this.sampleCounter * this.sampleRate) % 1 < this.sampleRate;
	}

	/**
	 * Log with lazy message evaluation
	 */
	log(level: LogLevel, messageFactory: MessageFactory | string): void {
		if (!this.shouldLog(level) || !this.shouldSample()) {
			return;
		}

		const message =
			typeof messageFactory === 'function' ? messageFactory() : messageFactory;
		const levelName = getLogLevelName(level);
		this.ringBuffer.add(`[${levelName}] ${message}`);
	}

	error(messageFactory: MessageFactory | string): void {
		this.log(LogLevel.ERROR, messageFactory);
	}

	warn(messageFactory: MessageFactory | string): void {
		this.log(LogLevel.WARN, messageFactory);
	}

	info(messageFactory: MessageFactory | string): void {
		this.log(LogLevel.INFO, messageFactory);
	}

	debug(messageFactory: MessageFactory | string): void {
		this.log(LogLevel.DEBUG, messageFactory);
	}

	verbose(messageFactory: MessageFactory | string): void {
		this.log(LogLevel.VERBOSE, messageFactory);
	}

	/**
	 * Get all buffered logs
	 */
	getLogs(): string[] {
		return this.ringBuffer.getAll();
	}

	/**
	 * Clear the log buffer
	 */
	clearLogs(): void {
		this.ringBuffer.clear();
	}

	/**
	 * Set the current log level
	 */
	setLevel(level: LogLevel): void {
		this.currentLevel = level;
	}

	/**
	 * Set the sample rate (0.0 to 1.0)
	 */
	setSampleRate(rate: number): void {
		this.sampleRate = Math.max(0, Math.min(1, rate));
	}
}

/**
 * Global efficient logger instance
 */
export const efficientLogger = new EfficientLogger();

/**
 * Performance-optimized string formatting
 */
export function fastFormat(template: string, ...args: any[]): string {
	if (args.length === 0) return template;

	let result = template;
	for (let i = 0; i < args.length; i++) {
		const placeholder = `{${i}}`;
		if (result.includes(placeholder)) {
			result = result.replace(placeholder, String(args[i]));
		}
	}
	return result;
}

/**
 * Conditional logging helper that only evaluates expensive operations when needed
 */
export function conditionalLog(
	level: LogLevel,
	condition: () => boolean,
	messageFactory: MessageFactory,
): void {
	// Note: shouldLog is private, so we need to use a different approach
	if (level <= LogLevel.INFO && condition()) {
		efficientLogger.log(level, messageFactory);
	}
}
