/**
 * Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 */

import * as BeforeExitListener from './BeforeExitListener.ts';
import { structuredConsole } from './LogPatch.ts';
import type RAPIDClient from './RAPIDClient.ts'; // Assuming RAPIDClient is the default export

// Define types for callbacks and context
type NodeStyleCallback = (error?: Error | string | null, result?: any) => void;
interface CallbackContextMembers {
	callbackWaitsForEmptyEventLoop: boolean;
	succeed: (result: any) => void;
	fail: (error: Error | string) => void;
	done: NodeStyleCallback;
}
type MarkCompletedFunction = () => void;

/**
 * Build the callback function and the part of the context which exposes
 * the succeed/fail/done callbacks.
 */
function _rawCallbackContext(
	client: RAPIDClient,
	id: string,
	scheduleNext: () => void,
): [NodeStyleCallback, CallbackContextMembers, MarkCompletedFunction] {
	const postError = async (err: Error | string, callback: () => void) => {
		structuredConsole.logError?.(
			'Invoke Error',
			err instanceof Error ? err : new Error(err),
		);
		// RAPIDClient.postInvocationError is now async and the callback is part of its own logic
		try {
			await client.postInvocationError(
				err instanceof Error ? err : new Error(String(err)),
				id,
				callback,
			);
		} catch (e) {
			console.error('CallbackContext: Failed to postInvocationError', e);
			// If posting error fails, still schedule next or exit based on original callback logic
			callback();
		}
	};

	let isCompleteInvoked = false;
	const complete = async (result: any, callback: () => void) => {
		if (isCompleteInvoked) {
			console.error(
				'Invocation has already been reported as done. Cannot call complete more than once per invocation.',
			);
			return;
		}
		isCompleteInvoked = true;
		// RAPIDClient.postInvocationResponse is now async
		try {
			await client.postInvocationResponse(result, id, callback);
		} catch (e) {
			console.error('CallbackContext: Failed to postInvocationResponse', e);
			callback(); // Ensure scheduleNext is called even if post fails
		}
	};

	let waitForEmptyEventLoop = true;

	const callback: NodeStyleCallback = (err, result) => {
		BeforeExitListener.reset();
		if (err != null) {
			// Check for null or undefined
			postError(err, scheduleNext);
		} else {
			if (!waitForEmptyEventLoop) {
				complete(result, scheduleNext);
			} else {
				BeforeExitListener.set(() => {
					setImmediate(() => {
						complete(result, scheduleNext);
					});
				});
			}
		}
	};

	const done: NodeStyleCallback = (err, result) => {
		BeforeExitListener.reset();
		if (err != null) {
			postError(err, scheduleNext);
		} else {
			complete(result, scheduleNext);
		}
	};
	const succeed = (result: any): void => {
		done(null, result);
	};
	const fail = (err: Error | string): void => {
		if (err == null) {
			// Check for null or undefined
			done('handled'); // Or new Error('handled')
		} else {
			done(err, null);
		}
	};

	const callbackContext: CallbackContextMembers = {
		get callbackWaitsForEmptyEventLoop(): boolean {
			return waitForEmptyEventLoop;
		},
		set callbackWaitsForEmptyEventLoop(value: boolean) {
			waitForEmptyEventLoop = value;
		},
		succeed: succeed,
		fail: fail,
		done: done,
	};

	const markCompleted: MarkCompletedFunction = () => {
		isCompleteInvoked = true;
	};

	return [callback, callbackContext, markCompleted];
}

/**
 * Wraps the callback and context so that only the first call to any callback
 * succeeds.
 */
function _wrappedCallbackContext(
	callback: NodeStyleCallback,
	callbackContext: CallbackContextMembers,
	markCompleted: MarkCompletedFunction,
): [NodeStyleCallback, CallbackContextMembers, MarkCompletedFunction] {
	let finished = false;
	const onlyAllowFirstCall = <T extends (...args: any[]) => any>(
		toWrap: T,
	): T => {
		return function (
			this: any,
			...args: Parameters<T>
		): ReturnType<T> | undefined {
			if (!finished) {
				finished = true; // Set finished flag immediately
				// markCompleted(); // This was called by _setDefaultExitListener, not directly by succeed/fail/done
				return toWrap.apply(this, args);
			}
		} as T;
	};

	// It's important that markCompleted is called by the exit listener,
	// not necessarily by every succeed/fail/done if they are called before exit.
	// The original logic for markCompleted was tied to _setDefaultExitListener.

	callbackContext.succeed = onlyAllowFirstCall(callbackContext.succeed);
	callbackContext.fail = onlyAllowFirstCall(callbackContext.fail);
	callbackContext.done = onlyAllowFirstCall(callbackContext.done);

	return [onlyAllowFirstCall(callback), callbackContext, markCompleted];
}

/**
 * Construct the base-context object which includes the required flags and
 * callback methods for the Node programming model.
 */
export function build(
	client: RAPIDClient,
	id: string,
	scheduleNext: () => void,
): [NodeStyleCallback, CallbackContextMembers, MarkCompletedFunction] {
	const rawCallbackContext = _rawCallbackContext(client, id, scheduleNext);
	return _wrappedCallbackContext(...rawCallbackContext);
}
