/**
 * Copyright 2022 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *
 * This module provides a writable stream interface for Lambda handlers
 * to stream responses, compatible with Bun.fetch and Lambda's streaming protocol.
 */

import { InvalidStreamingOperation, toRapidResponse } from './Errors.ts';
import { logger } from './VerboseLog.ts';

const { verbose } = logger('STREAM');

export const HEADER_RESPONSE_MODE = 'Lambda-Runtime-Function-Response-Mode';
export const VALUE_STREAMING = 'streaming';
export const TRAILER_NAME_ERROR_TYPE = 'Lambda-Runtime-Function-Error-Type';
const TRAILER_NAME_ERROR_BODY = 'Lambda-Runtime-Function-Error-Body';
export const DEFAULT_CONTENT_TYPE = 'application/octet-stream'; // Default if handler doesn't set one via prelude

export interface StreamErrorData {
	errorType: string;
	errorMessage: string;
	stackTrace?: string[];
}

// This is the object that will be given to the handler function.
// It needs to provide a WritableStream-like interface.
export class AwsWritableStream {
	private controller: TransformStreamDefaultController<Uint8Array>;
	private _writableState: {
		ended: boolean;
		errored: boolean;
		contentTypeSet: boolean;
		firstWriteDone: boolean;
	};
	private _contentType: string = DEFAULT_CONTENT_TYPE; // Will be overridden by prelude if HttpResponseStream is used

	// TODO: Expose more WritableStream properties if needed by handlers (e.g. highWaterMark, destroyed)

	constructor(controller: TransformStreamDefaultController<Uint8Array>) {
		this.controller = controller;
		this._writableState = {
			ended: false,
			errored: false,
			contentTypeSet: false,
			firstWriteDone: false,
		};
	}

	write(chunk: string | Uint8Array | Buffer): boolean {
		if (this._writableState.ended || this._writableState.errored) {
			verbose(
				'AwsWritableStream.write: Attempted to write to an ended or errored stream.',
			);
			// Should this throw, or return false, or be a no-op?
			// Node.js streams would typically emit an 'error' or allow the write but it might be lost.
			// For simplicity, let's make it a no-op and log.
			return false;
		}
		try {
			let bufferToWrite: Uint8Array;
			if (typeof chunk === 'string') {
				bufferToWrite = new TextEncoder().encode(chunk);
			} else if (chunk instanceof Buffer) {
				bufferToWrite = new Uint8Array(chunk);
			} else if (chunk instanceof Uint8Array) {
				bufferToWrite = chunk;
			} else {
				// Invalid chunk type, signal error
				const typeError = new TypeError(
					'The "chunk" argument must be of type string or an instance of Buffer or Uint8Array. Received an instance of ' +
						typeof chunk,
				);
				this.error(typeError);
				return false; // Indicate failure
			}
			this.controller.enqueue(bufferToWrite);
			this._writableState.firstWriteDone = true;
			return true; // Simplified: doesn't handle backpressure like Node streams yet
		} catch (e) {
			verbose('AwsWritableStream.write: Error enqueuing chunk', e);
			this._writableState.errored = true;
			// We should probably propagate this error to the readable side as an in-band trailer
			this.error(e instanceof Error ? e : new Error(String(e)));
			return false;
		}
	}

	end(
		chunk?: string | Uint8Array | Buffer,
		encoding?: BufferEncoding,
		callback?: () => void,
	): this {
		if (this._writableState.ended || this._writableState.errored) {
			verbose('AwsWritableStream.end: Stream already ended or errored.');
			if (callback) callback();
			return this;
		}
		if (chunk) {
			this.write(chunk); // encoding is ignored for now if chunk is string/Buffer
		}
		try {
			this.controller.terminate();
			this._writableState.ended = true;
			verbose('AwsWritableStream.end: Stream terminated.');
		} catch (e) {
			verbose('AwsWritableStream.end: Error terminating stream', e);
			this._writableState.errored = true;
			// This error might be too late for in-band trailers if controller.error() was not called before.
		}
		if (callback) callback();
		return this;
	}

	// Method to signal an error that should be sent as an in-band trailer
	error(err: Error): void {
		if (this._writableState.errored || this._writableState.ended) {
			verbose(
				'AwsWritableStream.error: Stream already errored or ended. Cannot signal new error.',
			);
			return;
		}
		verbose(
			'AwsWritableStream.error: Signaling stream error for in-band trailer:',
			err,
		);
		this._writableState.errored = true;

		const rapidError = toRapidResponse(err);
		const errorPayload: StreamErrorData = {
			errorType: rapidError.errorType,
			errorMessage: rapidError.errorMessage,
			stackTrace: rapidError.trace,
		};

		// This is the "in-band trailer" format.
		// It's a JSON object with specific keys, encoded as a string, then as bytes.
		// This needs to be the *last* thing written to the stream.
		const trailerJson = JSON.stringify(errorPayload);
		const trailerBytes = new TextEncoder().encode(
			`\0\0\0\0\0\0\0\0${TRAILER_NAME_ERROR_TYPE}:${errorPayload.errorType}\n${TRAILER_NAME_ERROR_BODY}:${trailerJson}\n`,
		);

		try {
			this.controller.enqueue(trailerBytes);
			this.controller.terminate(); // Ensure this is the absolute last thing.
			this._writableState.ended = true; // Mark as ended because error is terminal.
		} catch (e) {
			console.error(
				'AwsWritableStream.error: Failed to enqueue error trailer or terminate.',
				e,
			);
			// If this fails, the stream is in a bad state.
		}
	}

	setContentType(contentType: string): void {
		if (this._writableState.contentTypeSet) {
			throw new InvalidStreamingOperation('Content type can only be set once.');
		}
		if (this._writableState.firstWriteDone) {
			throw new InvalidStreamingOperation(
				'Content type cannot be set after the first write.',
			);
		}
		// This content type is for the *handler's response*, which goes into the prelude.
		// The overall stream to RAPID will have 'application/vnd.awslambda.http-integration-response'.
		this._contentType = contentType;
		this._writableState.contentTypeSet = true;
		// Note: This setContentType is a bit of a misnomer here. It's capturing the handler's intended
		// content type for the prelude. HttpResponseStream will set the actual outer content type.
	}

	getContentType(): string {
		return this._contentType;
	}

	get writableFinished(): boolean {
		return this._writableState.ended || this._writableState.errored;
	}

	// TODO: Add other WritableStream properties/methods if necessary for compatibility (e.g., destroy, cork, uncork)
}

export interface BunStreamAndMetadata {
	responseStream: AwsWritableStream; // This is what the handler interacts with
	readableForRapid: ReadableStream<Uint8Array>; // This is what goes to HttpResponseStream.from()
	// Add other necessary items, e.g., a promise that resolves when the stream is fully processed by RAPID.
}

/**
 * Creates a pair of streams for Lambda response streaming with Bun.
 * - responseStream: A WritableStream-like object for the handler to write to.
 * - readableForRapid: A ReadableStream that will contain the data written by the handler,
 *                     intended to be wrapped by HttpResponseStream.from() before sending to RAPID.
 */
export function createBunResponseStream(options?: {
	highWaterMark?: number;
}): BunStreamAndMetadata {
	let controllerRef: TransformStreamDefaultController<Uint8Array> | null = null;

	const transformStream = new TransformStream<Uint8Array, Uint8Array>(
		{
			start(controller) {
				controllerRef = controller;
				verbose('BunResponseStream: TransformStream started.');
			},
			transform(chunk, controller) {
				// Simply pass through chunks from handler's writes
				controller.enqueue(chunk);
				verbose(
					'BunResponseStream: Chunk transformed (enqueued). Size:',
					chunk.byteLength,
				);
			},
			flush(controller) {
				verbose('BunResponseStream: TransformStream flushed.');
				// Handler called .end()
				// controller.terminate(); // Already handled by AwsWritableStream.end()
			},
		},
		// TODO: Explore WritableStrategy and ReadableStrategy for backpressure if needed
		// new CountQueuingStrategy({ highWaterMark: options?.highWaterMark ?? 1 }),
		// new CountQueuingStrategy({ highWaterMark: options?.highWaterMark ?? 1 })
	);

	if (!controllerRef) {
		// This should not happen if the TransformStream constructor behaves as expected
		throw new Error('Failed to get TransformStream controller');
	}

	const handlerWritableStream = new AwsWritableStream(controllerRef);

	return {
		responseStream: handlerWritableStream,
		readableForRapid: transformStream.readable,
	};
}

// The old tryCallFail is not directly applicable as error handling is now part of AwsWritableStream.error()
// and the TransformStream.
