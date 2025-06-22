/**
 * Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *
 * The runtime has a single beforeExit function which is stored in the global
 * object with a symbol key.
 * The symbol is not exported.
 * The process.beforeExit listener is setup in index.mjs along with all other
 * top-level process event listeners.
 */

// define a named symbol for the handler function
const LISTENER_SYMBOL: unique symbol = Symbol.for('aws.lambda.beforeExit');
const NO_OP_LISTENER = (): void => {};

// Augment globalThis to declare the symbol for type safety
declare global {
	interface globalThis {
		[LISTENER_SYMBOL]?: () => void;
	}
}

// Initialize the global symbol if it doesn't exist, or ensure it's a function
// Accessing globalThis[LISTENER_SYMBOL] is now type-safe due to the augmentation.
if (typeof (globalThis as any)[LISTENER_SYMBOL] !== 'function') {
	(globalThis as any)[LISTENER_SYMBOL] = NO_OP_LISTENER;
}

/**
 * Call the listener function with no arguments.
 */
export function invoke(): void {
	const listener = (globalThis as any)[LISTENER_SYMBOL];
	if (listener) {
		listener();
	}
}

/**
 * Reset the listener to a no-op function.
 */
export function reset(): void {
	(globalThis as any)[LISTENER_SYMBOL] = NO_OP_LISTENER;
}

/**
 * Set the listener to the provided function.
 * If running in Bun, this becomes a no-op, effectively disabling the listener
 * due to observed unreliability of 'beforeExit' in bun:test.
 */
export function set(listener: () => void): void {
	if (process.versions?.bun) {
		// In Bun, make this a no-op or explicitly set to NO_OP_LISTENER.
		// This means the 'beforeExit' event, even if it fires, will call NO_OP_LISTENER.
		(globalThis as any)[LISTENER_SYMBOL] = NO_OP_LISTENER;
		// console.warn("BeforeExitListener.set is a no-op in Bun environment."); // Optional: for debugging
		return;
	}
	(globalThis as any)[LISTENER_SYMBOL] = listener;
}
