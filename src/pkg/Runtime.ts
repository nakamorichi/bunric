/**
 * Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *
 * This module defines the top-level Runtime class which controls the
 * bootstrap's execution flow.
 */

import * as BeforeExitListener from './BeforeExitListener.ts';
import { build as buildCallbackContext } from './CallbackContext.ts';
import InvokeContext from './InvokeContext.ts';
import type RAPIDClient from './RAPIDClient.ts'; // Default import
import { build as buildStreamingContext } from './StreamingContext.ts';
import { STREAM_RESPONSE_VALUE } from './UserFunction.ts'; // Use the exported const
import { logger } from './VerboseLog.ts';

const { verbose, vverbose } = logger('RAPID');

// Define types for handler and metadata
type LambdaHandler = (...args: any[]) => any;
interface HandlerMetadata {
	streaming: boolean | string; // string for STREAM_RESPONSE_VALUE
	highWaterMark?: number;
}
interface ErrorCallbacks {
	uncaughtException: (error: Error) => void;
	unhandledRejection: (error: Error) => void;
}

export default class Runtime {
	private client: RAPIDClient;
	private handler: LambdaHandler;
	private handlerMetadata: HandlerMetadata;
	private errorCallbacks: ErrorCallbacks;
	public handleOnce: () => Promise<void>; // Public for scheduleIteration, but could be private

	constructor(
		client: RAPIDClient,
		handler: LambdaHandler,
		handlerMetadata: HandlerMetadata,
		errorCallbacks: ErrorCallbacks,
	) {
		this.client = client;
		this.handler = handler;
		this.handlerMetadata = handlerMetadata;
		this.errorCallbacks = errorCallbacks;
		this.handleOnce =
			handlerMetadata.streaming === STREAM_RESPONSE_VALUE
				? this.handleOnceStreaming.bind(this)
				: this.handleOnceNonStreaming.bind(this);
	}

	/**
	 * Schedule the next loop iteration to start at the beginning of the next time
	 * around the event loop.
	 */
	scheduleIteration(): void {
		setImmediate(() => {
			this.handleOnce().then(
				() => {
					// Success is a no-op at this level.
				},
				(err: Error) => {
					console.error(`Unexpected Top Level Error: ${err.toString()}`, err);
					this.errorCallbacks.uncaughtException(err);
				},
			);
		});
	}

	/**
	 * Wait for the next invocation, process it, and schedule the next iteration.
	 */
	private async handleOnceNonStreaming(): Promise<void> {
		// RAPIDClient.nextInvocation() now returns a more structured object
		const invocation = await this.client.nextInvocation();
		// @ts-ignore _rawInvocationData is for easier adaptation later, not part of official type
		const rawInvocationData = invocation._rawInvocationData;

		// @ts-ignore Headers might not be fully compatible, this is for transition
		const invokeContext = new InvokeContext(invocation.headers || {});
		invokeContext.updateLoggingContext();

		const [callback, callbackContext, markCompleted] = buildCallbackContext(
			this.client,
			invokeContext.invokeId,
			this.scheduleIteration.bind(this),
		);

		try {
			this._setErrorCallbacks(invokeContext.invokeId);
			this._setDefaultExitListener(invokeContext.invokeId, markCompleted);

			// bodyJson is now directly the parsed event payload
			const eventPayload = invocation.bodyJson;

			const result = this.handler(
				eventPayload,
				invokeContext.attachEnvironmentData(callbackContext),
				callback,
			);

			if (_isPromise(result)) {
				result
					.then(callbackContext.succeed, callbackContext.fail)
					.catch(callbackContext.fail); // Ensure unhandled promise rejections in the handler are caught
			}
		} catch (err) {
			callback(err as Error);
		}
	}

	/**
	 * Wait for the next invocation, process it, and schedule the next iteration for streaming.
	 */
	private async handleOnceStreaming(): Promise<void> {
		const invocation = await this.client.nextInvocation();
		// @ts-ignore _rawInvocationData is for easier adaptation later
		const rawInvocationData = invocation._rawInvocationData;

		// @ts-ignore Headers might not be fully compatible
		const invokeContext = new InvokeContext(invocation.headers || {});
		invokeContext.updateLoggingContext();

		// StreamingContext.build will need to be adapted for the new client and invocation data
		const streamingContext = buildStreamingContext(
			this.client,
			invokeContext.invokeId,
			this.scheduleIteration.bind(this),
			this.handlerMetadata?.highWaterMark
				? { highWaterMark: this.handlerMetadata.highWaterMark }
				: undefined,
		);

		const {
			handlerResponseStream,
			finalizeAndPostStream, // New function from StreamingContext
			scheduleNext,
			fail: ctxFail, // Note: ctxFail's role might need to be reviewed.
			// Runtime should primarily use handlerResponseStream.error() for in-band errors.
		} = streamingContext.createStream();

		try {
			this._setErrorCallbacks(invokeContext.invokeId);
			this._setStreamingExitListener(
				invokeContext.invokeId,
				handlerResponseStream,
			);

			const ctx = invokeContext.attachEnvironmentData(streamingContext);

			verbose('Runtime::handleOnceStreaming', 'invoking handler');
			const event = invocation.bodyJson;
			const handlerResult = this.handler(event, handlerResponseStream, ctx);
			verbose('Runtime::handleOnceStreaming', 'handler returned');

			if (!_isPromise(handlerResult)) {
				const err = new Error('Streaming handler must return a Promise.');
				verbose('Runtime got non-promise response for streaming handler', err);
				handlerResponseStream.error(err); // Signal error on the stream
				// Intentionally fall through to finalizeAndPostStream to send the error trailer
			} else {
				try {
					const result = await handlerResult;
					if (typeof result !== 'undefined') {
						console.warn(
							'Streaming handlers ignore return values. Ensure the responseStream is used to send data.',
						);
					}
					verbose('Runtime::handleOnceStreaming handler promise resolved.');
				} catch (handlerError) {
					verbose(
						'Runtime::handleOnceStreaming handler promise rejected:',
						handlerError,
					);
					handlerResponseStream.error(handlerError as Error); // Signal error on the stream
					// Intentionally fall through to finalizeAndPostStream
				}
			}

			// Ensure the stream is ended by the handler, or if an error occurred above,
			// handlerResponseStream.error() should have ended it.
			if (!handlerResponseStream.writableFinished) {
				const err = new Error(
					'Response stream was not explicitly ended by the handler (or an error was not properly propagated to end the stream).',
				);
				verbose(err.message);
				handlerResponseStream.error(err);
			}

			// Always attempt to finalize and post the stream.
			// If an error was signaled via handlerResponseStream.error(), it will include an error trailer.
			// TODO: Define how metadataOverrides (statusCode, headers, cookies) would be passed from handler to here.
			// For now, finalizeAndPostStream will use defaults + handlerResponseStream.getContentType().
			await finalizeAndPostStream();
			vverbose(
				'Runtime::handleOnceStreaming: finalizeAndPostStream completed.',
			);

			scheduleNext();
		} catch (err) {
			// Catch errors from finalizeAndPostStream or other synchronous errors here
			verbose('Runtime::handleOnceStreaming top-level error:', err);
			// If finalizeAndPostStream itself fails, or some other unexpected error.
			// We need to ensure we post *something* to RAPID if possible, or exit.
			// The errorCallbacks are for broader process errors.
			// This specific catch might need to post a generic error to RAPID if the stream post failed.
			// For now, rely on errorCallbacks.uncaughtException for truly fatal errors.
			// If err came from finalizeAndPostStream, it might have already tried to post.
			// The safest is to call the generic error handler and let it decide.
			this.errorCallbacks.uncaughtException(err as Error);
			// scheduleNext(); // scheduleNext is usually called by errorCallbacks or postError
		}
	}

	/**
	 * Replace the error handler callbacks.
	 */
	private _setErrorCallbacks(invokeId: string): void {
		this.errorCallbacks.uncaughtException = async (error: Error) => {
			try {
				// RAPIDClient.postInvocationError is now async
				await this.client.postInvocationError(error, invokeId, () =>
					process.exit(129),
				);
			} catch (e) {
				console.error('Failed to postInvocationError for uncaughtException', e);
				process.exit(129);
			}
		};
		this.errorCallbacks.unhandledRejection = async (error: Error) => {
			try {
				// RAPIDClient.postInvocationError is now async
				await this.client.postInvocationError(error, invokeId, () =>
					process.exit(128),
				);
			} catch (e) {
				console.error(
					'Failed to postInvocationError for unhandledRejection',
					e,
				);
				process.exit(128);
			}
		};
	}

	/**
	 * Setup the 'beforeExit' listener for non-streaming handlers.
	 */
	private _setDefaultExitListener(
		invokeId: string,
		markCompleted: () => void,
	): void {
		BeforeExitListener.set(async () => {
			markCompleted(); // Mark as completed due to beforeExit
			try {
				// RAPIDClient.postInvocationResponse is now async
				await this.client.postInvocationResponse(null, invokeId, () =>
					this.scheduleIteration(),
				);
			} catch (e) {
				console.error(
					'Failed to postInvocationResponse in _setDefaultExitListener',
					e,
				);
				// Decide if we should still schedule iteration or exit
				this.scheduleIteration(); // Or potentially exit after logging
			}
		});
	}

	/**
	 * Setup the 'beforeExit' listener for streaming handlers.
	 */
	private _setStreamingExitListener(
		_invokeId: string,
		handlerResponseStream: any,
	): void {
		// For streaming, if beforeExit is hit, it might mean the stream wasn't properly closed.
		// The original logic just scheduled the next iteration.
		// We might want to ensure the stream is destroyed or an error is logged/posted.
		BeforeExitListener.set(() => {
			if (
				handlerResponseStream &&
				!(handlerResponseStream as any).destroyed &&
				(handlerResponseStream as any).writable
			) {
				console.warn(
					"Streaming response handler reached 'beforeExit' without closing the stream. Attempting to destroy stream.",
				);
				(handlerResponseStream as any).destroy?.(
					new Error('Stream not closed by handler before exit'),
				);
				// Potentially post an error to RAPID here if the stream was expected to be closed.
			}
			this.scheduleIteration();
		});
	}
}

function _isPromise(obj: any): obj is Promise<any> {
	return obj && typeof obj.then === 'function';
}
