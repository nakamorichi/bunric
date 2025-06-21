/**
 * Copyright 2021 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 */

import * as BeforeExitListener from './BeforeExitListener.ts';
import { InvalidStreamingOperation } from './Errors.ts';
import { HttpResponseStream } from './HttpResponseStream.ts';
import { structuredConsole } from './LogPatch.ts';
import type RAPIDClient from './RAPIDClient.ts';
import {
	type AwsWritableStream,
	createBunResponseStream,
	HEADER_RESPONSE_MODE,
	VALUE_STREAMING,
} from './ResponseStream.ts'; // Import constants
import { logger } from './VerboseLog.ts';

const { verbose, vverbose } = logger('STREAMING_CONTEXT');

interface StreamingContextOptions {
	highWaterMark?: number;
}

interface CreatedStreamObjects {
	// This is the stream the handler writes to.
	handlerResponseStream: AwsWritableStream;
	// This function should be called by Runtime when an error occurs that should terminate the current invocation loop.
	// It's responsible for ensuring the RAPID call (be it success or error) is made or awaited, then scheduling next.
	fail: (error: Error, scheduleNextCallback: () => void) => void; // Role might need refinement based on Runtime.ts
	// This function should be called by Runtime when handler completes successfully and stream is ended.
	scheduleNext: () => void;
	// NEW: Function to finalize prelude and post the stream. Returns promise for RAPID call completion.
	finalizeAndPostStream: (
		metadataOverrides?: Partial<Prelude>,
	) => Promise<void>;
}

// Prelude interface for metadataOverrides
interface Prelude {
	headers?: Record<string, string>;
	statusCode?: number;
	cookies?: string[];
}

export interface StreamingContextMembers {
	callbackWaitsForEmptyEventLoop: boolean;
	createStream: () => CreatedStreamObjects;
}

/**
 * Construct the context object for streaming responses.
 * @param client The RAPID client used to post results/errors.
 * @param invokeId The invokeId for the current invocation.
 * @param scheduleNextIteration A function which schedules the next iteration of the invoke loop.
 * @param options Streaming options like highWaterMark.
 */
export function build(
	client: RAPIDClient,
	invokeId: string,
	scheduleNextIteration: () => void,
	options?: StreamingContextOptions,
): StreamingContextMembers {
	let waitForEmptyEventLoop = true;
	let isStreamSetupDone = false; // Renamed from isStreamCreated for clarity

	const scheduleNextWithReset = () => {
		verbose('StreamingContext: scheduleNextWithReset called');
		BeforeExitListener.reset();
		if (!waitForEmptyEventLoop) {
			scheduleNextIteration();
		} else {
			BeforeExitListener.set(() => {
				setImmediate(() => {
					scheduleNextIteration();
				});
			});
		}
	};

	const streamingContext: StreamingContextMembers = {
		get callbackWaitsForEmptyEventLoop(): boolean {
			return waitForEmptyEventLoop;
		},
		set callbackWaitsForEmptyEventLoop(value: boolean) {
			waitForEmptyEventLoop = value;
		},
		createStream: (): CreatedStreamObjects => {
			if (isStreamSetupDone) {
				throw new InvalidStreamingOperation(
					'Stream components can only be set up once per StreamingContext.',
				);
			}

			const { responseStream: handlerWritable, readableForRapid } =
				createBunResponseStream(options);

			isStreamSetupDone = true;
			vverbose('StreamingContext.createStream: BunResponseStream created.');

			// The prelude needs to be constructed based on what the handler might set (e.g. content-type)
			// For now, using a default. This might need to be deferred until first write or handler signals.
			// The `HttpResponseStream.from` will prepend this.
			// The handler's intended content type is set via handlerWritable.setContentType()
			// and retrieved by handlerWritable.getContentType()
			// This prelude construction needs to happen *after* the handler has a chance to set its content type,
			// ideally just before the first byte is sent, or HttpResponseStream needs to be more dynamic.
			// For now, let's assume HttpResponseStream handles this by reading from handlerWritable.
			// The handler's intended content type is set via handlerWritable.setContentType()
			// and retrieved by handlerWritable.getContentType().
			// Other headers, statusCode, and cookies would need a mechanism for the handler to set them
			// on an httpResponseMetadata object, which would then be used here.
			// streamWithPrelude and rapidCallCompletionPromise are no longer created here directly.
			// They will be created in finalizeAndPostStream.

			const fail = async (error: Error, scheduleNextCb: () => void) => {
				// This 'fail' is intended to be called by Runtime.ts if the handler itself errors
				// in a way not caught and put onto the stream by the handler.
				// Runtime.ts should call handlerResponseStream.error() first, then finalizeAndPostStream(), then scheduleNextCb.
				// This specific 'fail' function might become simpler or be primarily for logging
				// if Runtime.ts orchestrates the error flow for streaming correctly.
				structuredConsole.logError?.(
					'StreamingContext.fail: Invoke Error reported to StreamingContext',
					error,
				);

				// Attempt to signal error on handler's stream if not already errored/ended.
				// This is a safety net. Runtime.ts should ideally do this more directly.
				if (!handlerWritable.writableFinished) {
					handlerWritable.error(error);
				}
				// The actual posting of the (now potentially errored) stream and scheduling
				// the next iteration is expected to be handled by Runtime.ts
				// by calling finalizeAndPostStream and then scheduleNext.
				// For now, just call scheduleNextCb as per original contract for the outer loop.
				scheduleNextCb();
			};

			const finalizeAndPostStream = async (
				metadataOverrides?: Partial<Prelude>,
			): Promise<void> => {
				const finalPrelude: Prelude = {
					statusCode: 200, // Default
					cookies: [], // Default
					...(metadataOverrides || {}), // Apply overrides first
					headers: {
						// Carefully merge headers
						...(metadataOverrides?.headers || {}),
						// Ensure handler's content type is primary unless explicitly overridden
						'content-type':
							metadataOverrides?.headers?.['content-type'] ||
							metadataOverrides?.headers?.['Content-Type'] ||
							handlerWritable.getContentType(),
					},
				};
				// Remove potential duplicate Content-Type if case-insensitively overridden
				if (
					metadataOverrides?.headers?.['Content-Type'] &&
					finalPrelude.headers?.['content-type'] &&
					metadataOverrides.headers['Content-Type'] !==
						finalPrelude.headers['content-type']
				) {
					delete finalPrelude.headers['Content-Type'];
				}

				const streamWithPrelude = HttpResponseStream.from(
					readableForRapid,
					finalPrelude,
				);
				vverbose(
					'StreamingContext.finalizeAndPostStream: Posting stream with prelude:',
					finalPrelude,
				);

				try {
					await client.postInvocationResponse(
						new Response(streamWithPrelude, {
							headers: { [HEADER_RESPONSE_MODE]: VALUE_STREAMING },
						}),
						invokeId,
						() => {
							vverbose(
								'StreamingContext.finalizeAndPostStream: RAPID postInvocationResponse callback executed (HTTP call finished).',
							);
						},
					);
				} catch (postError) {
					structuredConsole.logError?.(
						'StreamingContext.finalizeAndPostStream: Error posting invocation response to RAPID',
						postError instanceof Error
							? postError
							: new Error(String(postError)),
					);
					// If posting fails, we should still try to schedule the next iteration to avoid getting stuck.
					// The error should have been logged.
					throw postError; // Re-throw so Runtime.ts can also be aware if it awaits this.
				}
			};

			return {
				handlerResponseStream: handlerWritable,
				fail,
				scheduleNext: scheduleNextWithReset,
				finalizeAndPostStream,
			};
		},
	};

	return streamingContext;
}
