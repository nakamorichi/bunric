/**
 * Lazy loading utilities for reducing cold start time
 * Part of Phase 1: Foundation Optimizations
 */

type ModuleLoader<T> = () => T;

/**
 * Generic lazy loader for modules
 */
export class LazyModule<T> {
	private module: T | null = null;
	private loader: ModuleLoader<T>;
	private loading = false;

	constructor(loader: ModuleLoader<T>) {
		this.loader = loader;
	}

	get(): T {
		if (this.module === null && !this.loading) {
			this.loading = true;
			this.module = this.loader();
			this.loading = false;
		}
		return this.module!;
	}

	isLoaded(): boolean {
		return this.module !== null;
	}

	reset(): void {
		this.module = null;
		this.loading = false;
	}
}

/**
 * Lazy loaders for specific modules
 */
export const lazyXRayError = new LazyModule(() => {
	return require('../XRayError.ts');
});

export const lazyStreamingContext = new LazyModule(() => {
	return require('../StreamingContext.ts');
});

export const lazyResponseStream = new LazyModule(() => {
	return require('../ResponseStream.ts');
});

/**
 * Utility function to check if X-Ray is enabled
 */
export function isXRayEnabled(): boolean {
	return process.env._X_AMZN_TRACE_ID !== undefined;
}

/**
 * Get XRayError only when needed
 */
export function getXRayError() {
	if (!isXRayEnabled()) {
		return null;
	}
	return lazyXRayError.get();
}

/**
 * Get StreamingContext only when needed
 */
export function getStreamingContext() {
	return lazyStreamingContext.get();
}

/**
 * Get ResponseStream only when needed
 */
export function getResponseStream() {
	return lazyResponseStream.get();
}
