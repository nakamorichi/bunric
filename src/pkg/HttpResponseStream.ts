/**
 * Copyright 2022 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *
 * HttpResponseStream is used to format a handler's response stream
 * according to the AWS Lambda HTTP streaming integration response protocol.
 * It prepends a JSON metadata prelude and an 8-byte null delimiter
 * to the underlying response data stream.
 */

// This constant is not directly used by this module anymore for setting content type,
// but it's a good reference for the overall content type BunRapidClient will set.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const METADATA_PRELUDE_CONTENT_TYPE =
	'application/vnd.awslambda.http-integration-response';
const DELIMITER_LEN = 8;

interface Prelude {
	headers?: Record<string, string>;
	statusCode?: number;
	cookies?: string[];
}

// Implements the application/vnd.awslambda.http-integration-response content type formatting.
export function createHttpResponseStream(
	underlyingStream: ReadableStream<Uint8Array>,
	prelude: Prelude,
): ReadableStream<Uint8Array> {
	const metadataPrelude = JSON.stringify(prelude);
	const preludeBytes = new TextEncoder().encode(metadataPrelude);
	const delimiterBytes = new Uint8Array(DELIMITER_LEN); // Defaults to all zeros (null bytes)

	const transform = new TransformStream<Uint8Array, Uint8Array>({
		start(controller) {
			controller.enqueue(preludeBytes);
			controller.enqueue(delimiterBytes);
		},
		transform(chunk, controller) {
			controller.enqueue(chunk);
		},
		// flush(controller) is not strictly needed here as the underlyingStream
		// closing will naturally end this transform stream.
	});

	// Pipe the underlying stream through the transform.
	// Errors from underlyingStream or during transformation will propagate to the returned readable.
	// The pipeTo operation is async but we return the readable side synchronously.
	underlyingStream.pipeTo(transform.writable).catch((error) => {
		// If the pipe fails, the transform.readable will error.
		// We can log it here for server-side diagnostics if needed.
		console.error(
			'[HttpResponseStream] Error piping underlying stream:',
			error,
		);
		// The error should already be propagated to transform.readable by the stream internals.
	});

	return transform.readable;
}

// Legacy class interface for backward compatibility
// biome-ignore lint/complexity/noStaticOnlyClass: Legacy compatibility interface
export class HttpResponseStream {
	static from(
		underlyingStream: ReadableStream<Uint8Array>,
		prelude: Prelude,
	): ReadableStream<Uint8Array> {
		return createHttpResponseStream(underlyingStream, prelude);
	}
}
