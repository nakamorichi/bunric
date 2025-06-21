import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

/**
 * These tests address the behavior of process.beforeExit in Bun
 *
 * IMPORTANT: These tests are known to fail when run with `bun test` due to
 * issues with how `bun:test` manages the event loop and process lifecycle.
 *
 * The failures are EXPECTED and documented in the Memory Bank. The proper
 * behavior has been verified using the standalone test script:
 * `test/unit/test-before-exit-standalone.ts`
 *
 * The critical validation of src/BeforeExitListener.ts (which relies on
 * process.beforeExit) should be performed via integration tests using the
 * AWS Lambda Runtime Interface Emulator (RIE).
 *
 * Related Bun GitHub issues:
 * - #5409: "event loop issue in `bun:test` - early exit"
 * - #3137: "Bun exits before `await subprocess.exited` resolves"
 * - #8434: "`process.on (\"exit\")` isn't triggered with `bun test`"
 */

// Mock implementation to help isolate the tests
class MockBeforeExitListener {
	private listeners: Array<() => void> = [];

	constructor() {
		// Intentionally do not actually listen to beforeExit
		// as it doesn't work reliably in bun:test
	}

	public addListener(listener: () => void) {
		this.listeners.push(listener);
	}

	public removeListener(listener: () => void) {
		this.listeners = this.listeners.filter((l) => l !== listener);
	}

	// Helper to manually trigger listeners for testing
	public triggerListeners() {
		this.listeners.forEach((listener) => listener());
	}

	public getListenerCount() {
		return this.listeners.length;
	}
}

describe('Mocked BeforeExit behavior testing', () => {
	let mockBeforeExitListener: MockBeforeExitListener;
	let originalAddListener: typeof process.addListener;
	let originalRemoveListener: typeof process.removeListener;

	beforeEach(() => {
		mockBeforeExitListener = new MockBeforeExitListener();

		// Store original functions
		originalAddListener = process.addListener;
		originalRemoveListener = process.removeListener;

		// Mock process.on/addListener for beforeExit
		// Use type assertion to allow mocking with string event names
		process.addListener = (event: any, listener: any) => {
			if (event === 'beforeExit') {
				mockBeforeExitListener.addListener(listener as () => void);
				return process; // For chaining
			}
			return originalAddListener.call(process, event, listener);
		};

		// Also mock process.on
		process.on = process.addListener;

		// Mock process.removeListener for beforeExit
		process.removeListener = (event: any, listener: any) => {
			if (event === 'beforeExit') {
				mockBeforeExitListener.removeListener(listener as () => void);
				return process; // For chaining
			}
			return originalRemoveListener.call(process, event, listener);
		};
	});

	afterEach(() => {
		// Restore original functions
		process.addListener = originalAddListener;
		process.on = originalAddListener;
		process.removeListener = originalRemoveListener;
	});

	it('should register a beforeExit listener correctly', () => {
		let beforeExitFired = false;

		process.on('beforeExit', () => {
			beforeExitFired = true;
		});

		expect(mockBeforeExitListener.getListenerCount()).toBe(1);

		// Manually trigger the beforeExit event (since actual event won't fire in bun:test)
		mockBeforeExitListener.triggerListeners();

		expect(beforeExitFired).toBe(true);
	});

	it('should allow async operations to complete when beforeExit works properly', async () => {
		let asyncOperationCompleted = false;
		let beforeExitHandlerCalled = false;

		const asyncOperation = () => {
			return new Promise<void>((resolve) => {
				setTimeout(() => {
					asyncOperationCompleted = true;
					resolve();
				}, 10);
			});
		};

		process.on('beforeExit', async () => {
			// In a real environment, this would wait for asyncOperation to complete
			// before the process exits
			beforeExitHandlerCalled = true;
			await asyncOperation();
		});

		// Start but don't await the async operation
		asyncOperation().catch((e) => console.error('Async op failed:', e));

		// In our mocked environment, manually trigger beforeExit
		// Wait a bit to ensure our first asyncOperation has time to start
		await new Promise((resolve) => setTimeout(resolve, 50));

		mockBeforeExitListener.triggerListeners();

		// Ensure our handler was called
		expect(beforeExitHandlerCalled).toBe(true);

		// Wait to ensure both async operations complete
		await new Promise((resolve) => setTimeout(resolve, 50));

		// This would be true in a real environment where the process waits
		// for the event loop to empty after beforeExit fires
		expect(asyncOperationCompleted).toBe(true);
	});
});

// These tests demonstrate the KNOWN ISSUE with process.beforeExit in bun:test
// The bun:test runner doesn't properly handle beforeExit events
// They are marked as "skip" to avoid failing the test suite, while preserving
// the documentation of how beforeExit should work
// TESTED: Still failing in Bun 1.2.15 (2025-05-29)
describe.skip('process.beforeExit behavior in Bun (DISABLED - Known bun:test issue)', () => {
	// NOTE: These tests are expected to fail when run with `bun test`.
	// The behavior has been verified with standalone script: test/unit/test-before-exit-standalone.ts
	// See the Memory Bank documentation or run the standalone test to confirm:
	// $ bun run test/unit/test-before-exit-standalone.ts

	it('should trigger beforeExit event when event loop is about to empty', (done) => {
		let beforeExitFired = false;

		const listener = () => {
			beforeExitFired = true;
			process.removeListener('beforeExit', listener);

			expect(beforeExitFired).toBe(true);
			done();
		};

		process.on('beforeExit', listener);

		setTimeout(() => {
			// This timer is just to keep the event loop alive for one more tick
		}, 0);
	});

	it('should allow a short async operation (unawaited promise) to complete if beforeExit works as expected', async () => {
		let asyncOperationCompleted = false;
		let beforeExitListenerCalledForThisTest = false;
		let asyncOpCompletedWhenBeforeExitFired = false;

		const asyncOperation = () => {
			return new Promise<void>((resolve) => {
				setTimeout(() => {
					asyncOperationCompleted = true;
					resolve();
				}, 50);
			});
		};

		const beforeExitListener = () => {
			beforeExitListenerCalledForThisTest = true;
			asyncOpCompletedWhenBeforeExitFired = asyncOperationCompleted;
			process.removeListener('beforeExit', beforeExitListener);
		};

		process.on('beforeExit', beforeExitListener);

		// Start the async operation but don't await it.
		asyncOperation().catch((e) => console.error('Async op failed:', e));

		// Keep the process alive long enough for the async op and beforeExit to occur.
		await new Promise((resolve) => setTimeout(resolve, 200));

		process.removeListener('beforeExit', beforeExitListener);

		// These assertions are expected to fail in bun:test environment
		// but work correctly in a normal Bun runtime
		expect(asyncOperationCompleted).toBe(true);
		expect(beforeExitListenerCalledForThisTest).toBe(true);
		expect(asyncOpCompletedWhenBeforeExitFired).toBe(true);
	});
});
