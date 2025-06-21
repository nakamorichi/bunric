/**
 * Error Recovery System with Circuit Breakers
 * Part of Phase 3: Architectural Refinements
 */

/**
 * Circuit breaker states
 */
export enum CircuitState {
	CLOSED = 'closed', // Normal operation
	OPEN = 'open', // Failing, rejecting requests
	HALF_OPEN = 'half_open', // Testing if service recovered
}

/**
 * Error classification for recovery strategies
 */
export enum ErrorType {
	TRANSIENT = 'transient', // Temporary errors (network, timeout)
	PERMANENT = 'permanent', // Permanent errors (invalid input, auth)
	RATE_LIMIT = 'rate_limit', // Rate limiting errors
	RESOURCE = 'resource', // Resource exhaustion
	UNKNOWN = 'unknown', // Unclassified errors
}

/**
 * Recovery strategy configuration
 */
export interface RecoveryStrategy {
	maxRetries: number;
	baseDelay: number; // Base delay in milliseconds
	maxDelay: number; // Maximum delay in milliseconds
	backoffMultiplier: number; // Exponential backoff multiplier
	jitterFactor: number; // Random jitter factor (0-1)
	retryableErrors: ErrorType[];
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
	failureThreshold: number; // Number of failures to open circuit
	recoveryTimeout: number; // Time to wait before half-open (ms)
	successThreshold: number; // Successes needed to close circuit
	monitoringWindow: number; // Time window for failure counting (ms)
	volumeThreshold: number; // Minimum requests before circuit can open
}

/**
 * Error recovery statistics
 */
export interface RecoveryStats {
	totalAttempts: number;
	successfulRecoveries: number;
	permanentFailures: number;
	circuitBreakerTrips: number;
	averageRecoveryTime: number;
	errorsByType: Record<ErrorType, number>;
	lastRecoveryTime: number;
}

/**
 * Circuit breaker statistics
 */
export interface CircuitBreakerStats {
	state: CircuitState;
	failureCount: number;
	successCount: number;
	lastFailureTime: number;
	lastSuccessTime: number;
	totalRequests: number;
	rejectedRequests: number;
	stateTransitions: number;
}

/**
 * Recovery attempt result
 */
export interface RecoveryResult<T> {
	success: boolean;
	result?: T;
	error?: Error;
	attemptCount: number;
	totalTime: number;
	recoveryStrategy: string;
}

/**
 * Circuit breaker implementation
 */
export class CircuitBreaker {
	private state: CircuitState = CircuitState.CLOSED;
	private failureCount: number = 0;
	private successCount: number = 0;
	private lastFailureTime: number = 0;
	private lastSuccessTime: number = 0;
	private nextAttemptTime: number = 0;
	private stats: CircuitBreakerStats;
	private recentRequests: { timestamp: number; success: boolean }[] = [];

	constructor(
		private name: string,
		private config: CircuitBreakerConfig,
	) {
		this.stats = this.initializeStats();
	}

	private initializeStats(): CircuitBreakerStats {
		return {
			state: CircuitState.CLOSED,
			failureCount: 0,
			successCount: 0,
			lastFailureTime: 0,
			lastSuccessTime: 0,
			totalRequests: 0,
			rejectedRequests: 0,
			stateTransitions: 0,
		};
	}

	/**
	 * Execute a function with circuit breaker protection
	 */
	async execute<T>(fn: () => Promise<T>): Promise<T> {
		this.cleanupOldRequests();

		if (this.state === CircuitState.OPEN) {
			if (Date.now() < this.nextAttemptTime) {
				this.stats.rejectedRequests++;
				throw new Error(
					`Circuit breaker '${this.name}' is OPEN. Next attempt allowed at ${new Date(this.nextAttemptTime).toISOString()}`,
				);
			} else {
				this.transitionTo(CircuitState.HALF_OPEN);
			}
		}

		this.stats.totalRequests++;
		const requestTime = Date.now();

		try {
			const result = await fn();
			this.onSuccess(requestTime);
			return result;
		} catch (error) {
			this.onFailure(requestTime, error as Error);
			throw error;
		}
	}

	/**
	 * Handle successful execution
	 */
	private onSuccess(timestamp: number): void {
		this.lastSuccessTime = timestamp;
		this.recentRequests.push({ timestamp, success: true });

		if (this.state === CircuitState.HALF_OPEN) {
			this.successCount++;
			if (this.successCount >= this.config.successThreshold) {
				this.transitionTo(CircuitState.CLOSED);
			}
		} else if (this.state === CircuitState.CLOSED) {
			this.failureCount = Math.max(0, this.failureCount - 1);
		}
	}

	/**
	 * Handle failed execution
	 */
	private onFailure(timestamp: number, error: Error): void {
		this.lastFailureTime = timestamp;
		this.failureCount++;
		this.recentRequests.push({ timestamp, success: false });

		if (this.state === CircuitState.HALF_OPEN) {
			this.transitionTo(CircuitState.OPEN);
		} else if (this.state === CircuitState.CLOSED) {
			if (this.shouldOpenCircuit()) {
				this.transitionTo(CircuitState.OPEN);
			}
		}
	}

	/**
	 * Determine if circuit should open based on failure rate
	 */
	private shouldOpenCircuit(): boolean {
		const recentFailures = this.recentRequests.filter(
			(req) => !req.success,
		).length;
		const totalRecent = this.recentRequests.length;

		return (
			totalRecent >= this.config.volumeThreshold &&
			recentFailures >= this.config.failureThreshold
		);
	}

	/**
	 * Transition circuit breaker to new state
	 */
	private transitionTo(newState: CircuitState): void {
		const oldState = this.state;
		this.state = newState;
		this.stats.state = newState;
		this.stats.stateTransitions++;

		switch (newState) {
			case CircuitState.OPEN:
				this.nextAttemptTime = Date.now() + this.config.recoveryTimeout;
				break;
			case CircuitState.HALF_OPEN:
				this.successCount = 0;
				break;
			case CircuitState.CLOSED:
				this.failureCount = 0;
				this.successCount = 0;
				break;
		}

		console.log(
			`Circuit breaker '${this.name}' transitioned from ${oldState} to ${newState}`,
		);
	}

	/**
	 * Clean up old request records outside monitoring window
	 */
	private cleanupOldRequests(): void {
		const cutoffTime = Date.now() - this.config.monitoringWindow;
		this.recentRequests = this.recentRequests.filter(
			(req) => req.timestamp > cutoffTime,
		);
	}

	/**
	 * Get current circuit breaker statistics
	 */
	getStats(): CircuitBreakerStats {
		this.cleanupOldRequests();
		return {
			...this.stats,
			failureCount: this.failureCount,
			successCount: this.successCount,
			lastFailureTime: this.lastFailureTime,
			lastSuccessTime: this.lastSuccessTime,
		};
	}

	/**
	 * Reset circuit breaker to initial state
	 */
	reset(): void {
		this.state = CircuitState.CLOSED;
		this.failureCount = 0;
		this.successCount = 0;
		this.lastFailureTime = 0;
		this.lastSuccessTime = 0;
		this.nextAttemptTime = 0;
		this.recentRequests = [];
		this.stats = this.initializeStats();
	}

	/**
	 * Force circuit breaker to specific state (for testing)
	 */
	forceState(state: CircuitState): void {
		this.transitionTo(state);
	}
}

/**
 * Error classifier for determining recovery strategies
 */
export class ErrorClassifier {
	private static readonly TRANSIENT_PATTERNS = [
		/timeout/i,
		/connection/i,
		/network/i,
		/temporary/i,
		/unavailable/i,
		/503/,
		/502/,
		/504/,
	];

	private static readonly RATE_LIMIT_PATTERNS = [
		/rate.?limit/i,
		/too.?many.?requests/i,
		/429/,
		/quota/i,
		/throttle/i,
	];

	private static readonly PERMANENT_PATTERNS = [
		/400/,
		/401/,
		/403/,
		/404/,
		/invalid/i,
		/unauthorized/i,
		/forbidden/i,
		/not.?found/i,
	];

	/**
	 * Classify error type for recovery strategy selection
	 */
	static classifyError(error: Error): ErrorType {
		const message = error.message.toLowerCase();
		const stack = error.stack?.toLowerCase() || '';
		const combined = `${message} ${stack}`;

		if (
			ErrorClassifier.PERMANENT_PATTERNS.some((pattern) =>
				pattern.test(combined),
			)
		) {
			return ErrorType.PERMANENT;
		}

		if (
			ErrorClassifier.RATE_LIMIT_PATTERNS.some((pattern) =>
				pattern.test(combined),
			)
		) {
			return ErrorType.RATE_LIMIT;
		}

		if (
			ErrorClassifier.TRANSIENT_PATTERNS.some((pattern) =>
				pattern.test(combined),
			)
		) {
			return ErrorType.TRANSIENT;
		}

		// Check for resource exhaustion patterns
		if (
			combined.includes('memory') ||
			combined.includes('resource') ||
			combined.includes('limit')
		) {
			return ErrorType.RESOURCE;
		}

		return ErrorType.UNKNOWN;
	}

	/**
	 * Determine if error is retryable based on classification
	 */
	static isRetryable(error: Error, strategy: RecoveryStrategy): boolean {
		const errorType = ErrorClassifier.classifyError(error);
		return strategy.retryableErrors.includes(errorType);
	}
}

/**
 * Advanced error recovery system with multiple strategies
 */
export class ErrorRecoverySystem {
	private circuitBreakers = new Map<string, CircuitBreaker>();
	private stats: RecoveryStats;
	private strategies = new Map<string, RecoveryStrategy>();

	constructor() {
		this.stats = this.initializeStats();
		this.setupDefaultStrategies();
	}

	private initializeStats(): RecoveryStats {
		return {
			totalAttempts: 0,
			successfulRecoveries: 0,
			permanentFailures: 0,
			circuitBreakerTrips: 0,
			averageRecoveryTime: 0,
			errorsByType: {
				[ErrorType.TRANSIENT]: 0,
				[ErrorType.PERMANENT]: 0,
				[ErrorType.RATE_LIMIT]: 0,
				[ErrorType.RESOURCE]: 0,
				[ErrorType.UNKNOWN]: 0,
			},
			lastRecoveryTime: 0,
		};
	}

	/**
	 * Setup default recovery strategies
	 */
	private setupDefaultStrategies(): void {
		// Standard transient error strategy
		this.strategies.set('transient', {
			maxRetries: 3,
			baseDelay: 1000,
			maxDelay: 30000,
			backoffMultiplier: 2,
			jitterFactor: 0.1,
			retryableErrors: [ErrorType.TRANSIENT, ErrorType.UNKNOWN],
		});

		// Rate limiting strategy with longer delays
		this.strategies.set('rate_limit', {
			maxRetries: 5,
			baseDelay: 5000,
			maxDelay: 60000,
			backoffMultiplier: 1.5,
			jitterFactor: 0.2,
			retryableErrors: [ErrorType.RATE_LIMIT],
		});

		// Resource exhaustion strategy
		this.strategies.set('resource', {
			maxRetries: 2,
			baseDelay: 2000,
			maxDelay: 10000,
			backoffMultiplier: 3,
			jitterFactor: 0.3,
			retryableErrors: [ErrorType.RESOURCE],
		});

		// Conservative strategy for unknown errors
		this.strategies.set('conservative', {
			maxRetries: 1,
			baseDelay: 500,
			maxDelay: 5000,
			backoffMultiplier: 2,
			jitterFactor: 0.1,
			retryableErrors: [ErrorType.UNKNOWN],
		});
	}

	/**
	 * Register a custom recovery strategy
	 */
	registerStrategy(name: string, strategy: RecoveryStrategy): void {
		this.strategies.set(name, strategy);
	}

	/**
	 * Get or create circuit breaker for a service
	 */
	getCircuitBreaker(
		name: string,
		config?: CircuitBreakerConfig,
	): CircuitBreaker {
		if (!this.circuitBreakers.has(name)) {
			const defaultConfig: CircuitBreakerConfig = {
				failureThreshold: 5,
				recoveryTimeout: 60000, // 1 minute
				successThreshold: 3,
				monitoringWindow: 300000, // 5 minutes
				volumeThreshold: 10,
			};

			this.circuitBreakers.set(
				name,
				new CircuitBreaker(name, config || defaultConfig),
			);
		}

		return this.circuitBreakers.get(name)!;
	}

	/**
	 * Execute function with comprehensive error recovery
	 */
	async executeWithRecovery<T>(
		fn: () => Promise<T>,
		options: {
			circuitBreakerName?: string;
			strategyName?: string;
			customStrategy?: RecoveryStrategy;
			circuitBreakerConfig?: CircuitBreakerConfig;
		} = {},
	): Promise<RecoveryResult<T>> {
		const startTime = Date.now();
		const strategy =
			options.customStrategy ||
			this.strategies.get(options.strategyName || 'transient') ||
			this.strategies.get('transient')!;

		let lastError: Error | undefined;
		let attemptCount = 0;

		// Wrap with circuit breaker if specified
		const executeFunction = options.circuitBreakerName
			? () =>
					this.getCircuitBreaker(
						options.circuitBreakerName!,
						options.circuitBreakerConfig,
					).execute(fn)
			: fn;

		this.stats.totalAttempts++;

		for (
			attemptCount = 1;
			attemptCount <= strategy.maxRetries + 1;
			attemptCount++
		) {
			try {
				const result = await executeFunction();

				// Success - update stats
				if (attemptCount > 1) {
					this.stats.successfulRecoveries++;
					this.stats.lastRecoveryTime = Date.now();
					this.updateAverageRecoveryTime(Date.now() - startTime);
				}

				return {
					success: true,
					result,
					attemptCount,
					totalTime: Date.now() - startTime,
					recoveryStrategy: options.strategyName || 'transient',
				};
			} catch (error) {
				lastError = error as Error;
				const errorType = ErrorClassifier.classifyError(lastError);
				this.stats.errorsByType[errorType]++;

				// Check if error is retryable
				if (!ErrorClassifier.isRetryable(lastError, strategy)) {
					this.stats.permanentFailures++;
					break;
				}

				// Don't delay after the last attempt
				if (attemptCount <= strategy.maxRetries) {
					const delay = this.calculateDelay(attemptCount - 1, strategy);
					await this.sleep(delay);
				}
			}
		}

		// All attempts failed
		return {
			success: false,
			error: lastError,
			attemptCount,
			totalTime: Date.now() - startTime,
			recoveryStrategy: options.strategyName || 'transient',
		};
	}

	/**
	 * Calculate delay with exponential backoff and jitter
	 */
	private calculateDelay(
		attemptNumber: number,
		strategy: RecoveryStrategy,
	): number {
		const exponentialDelay =
			strategy.baseDelay * strategy.backoffMultiplier ** attemptNumber;
		const cappedDelay = Math.min(exponentialDelay, strategy.maxDelay);

		// Add jitter to prevent thundering herd
		const jitter = cappedDelay * strategy.jitterFactor * Math.random();

		return Math.floor(cappedDelay + jitter);
	}

	/**
	 * Sleep for specified milliseconds
	 */
	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	/**
	 * Update average recovery time with exponential moving average
	 */
	private updateAverageRecoveryTime(recoveryTime: number): void {
		if (this.stats.averageRecoveryTime === 0) {
			this.stats.averageRecoveryTime = recoveryTime;
		} else {
			// Exponential moving average with alpha = 0.1
			this.stats.averageRecoveryTime =
				0.9 * this.stats.averageRecoveryTime + 0.1 * recoveryTime;
		}
	}

	/**
	 * Get comprehensive recovery statistics
	 */
	getStats(): RecoveryStats & {
		circuitBreakers: Record<string, CircuitBreakerStats>;
	} {
		const circuitBreakerStats: Record<string, CircuitBreakerStats> = {};

		for (const [name, breaker] of this.circuitBreakers.entries()) {
			circuitBreakerStats[name] = breaker.getStats();
		}

		return {
			...this.stats,
			circuitBreakers: circuitBreakerStats,
		};
	}

	/**
	 * Reset all statistics and circuit breakers
	 */
	reset(): void {
		this.stats = this.initializeStats();
		for (const breaker of this.circuitBreakers.values()) {
			breaker.reset();
		}
	}

	/**
	 * Health check for all circuit breakers
	 */
	getHealthStatus(): {
		healthy: boolean;
		details: Record<string, { state: CircuitState; healthy: boolean }>;
	} {
		const details: Record<string, { state: CircuitState; healthy: boolean }> =
			{};
		let overallHealthy = true;

		for (const [name, breaker] of this.circuitBreakers.entries()) {
			const stats = breaker.getStats();
			const healthy = stats.state !== CircuitState.OPEN;

			details[name] = {
				state: stats.state,
				healthy,
			};

			if (!healthy) {
				overallHealthy = false;
			}
		}

		return {
			healthy: overallHealthy,
			details,
		};
	}
}

/**
 * Global error recovery system instance
 */
export const globalErrorRecovery = new ErrorRecoverySystem();

/**
 * Utility decorators for error recovery
 */
export function WithCircuitBreaker(
	name: string,
	config?: CircuitBreakerConfig,
) {
	return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
		const originalMethod = descriptor.value;

		descriptor.value = async function (...args: any[]) {
			const circuitBreaker = globalErrorRecovery.getCircuitBreaker(
				name,
				config,
			);
			return circuitBreaker.execute(() => originalMethod.apply(this, args));
		};

		return descriptor;
	};
}

export function WithRetry(
	strategyName: string = 'transient',
	circuitBreakerName?: string,
) {
	return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
		const originalMethod = descriptor.value;

		descriptor.value = async function (...args: any[]) {
			const result = await globalErrorRecovery.executeWithRecovery(
				() => originalMethod.apply(this, args),
				{ strategyName, circuitBreakerName },
			);

			if (result.success) {
				return result.result;
			} else {
				throw result.error;
			}
		};

		return descriptor;
	};
}
