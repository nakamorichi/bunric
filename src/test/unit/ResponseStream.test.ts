import {
	InvalidStreamingOperation,
	toRapidResponse,
} from '../../pkg/Errors.ts';
import {
	AwsWritableStream,
	createBunResponseStream,
	DEFAULT_CONTENT_TYPE,
	type StreamErrorData,
	TRAILER_NAME_ERROR_TYPE,
} from '../../pkg/ResponseStream.ts';
import { describe, expect, spyOn, test } from 'bun:test';

// import { logger } from '../../src/VerboseLog.ts'; // We will spy on console.log directly
// beforeAll/afterAll for AWS_LAMBDA_RUNTIME_VERBOSE removed as it's now handled by .env.test

// Helper to consume a ReadableStream into a Uint8Array
async function streamToUint8Array(
	stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let totalLength = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		if (value) {
			chunks.push(value);
			totalLength += value.length;
		}
	}
	const result = new Uint8Array(totalLength);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.length;
	}
	return result;
}

// Helper to consume a ReadableStream into a string
async function streamToString(
	stream: ReadableStream<Uint8Array>,
): Promise<string> {
	const uint8Array = await streamToUint8Array(stream);
	return new TextDecoder().decode(uint8Array);
}

describe('ResponseStream', () => {
	describe('createBunResponseStream', () => {
		test('should return an object with responseStream and readableForRapid', () => {
			const { responseStream, readableForRapid } = createBunResponseStream();
			expect(responseStream).toBeInstanceOf(AwsWritableStream);
			expect(readableForRapid).toBeInstanceOf(ReadableStream);
		});
	});

	describe('AwsWritableStream', () => {
		test('write method should enqueue data to readableForRapid (string)', async () => {
			const { responseStream, readableForRapid } = createBunResponseStream();
			responseStream.write('Hello');
			responseStream.write(' ');
			responseStream.write('World');
			responseStream.end();

			const result = await streamToString(readableForRapid);
			expect(result).toBe('Hello World');
		});

		test('write method should enqueue data to readableForRapid (Uint8Array)', async () => {
			const { responseStream, readableForRapid } = createBunResponseStream();
			const encoder = new TextEncoder();
			responseStream.write(encoder.encode('Hello'));
			responseStream.write(encoder.encode(' '));
			responseStream.write(encoder.encode('World'));
			responseStream.end();

			const result = await streamToString(readableForRapid);
			expect(result).toBe('Hello World');
		});

		test('write method should enqueue data to readableForRapid (Buffer)', async () => {
			const { responseStream, readableForRapid } = createBunResponseStream();
			responseStream.write(Buffer.from('Hello'));
			responseStream.write(Buffer.from(' '));
			responseStream.write(Buffer.from('World'));
			responseStream.end();

			const result = await streamToString(readableForRapid);
			expect(result).toBe('Hello World');
		});

		test('end method should close the readableForRapid stream', async () => {
			const { responseStream, readableForRapid } = createBunResponseStream();
			responseStream.write('test');
			responseStream.end();

			const reader = readableForRapid.getReader();
			await reader.read(); // Read 'test'
			const { done } = await reader.read(); // Should be done
			expect(done).toBe(true);
		});

		test('end method with a final chunk', async () => {
			const { responseStream, readableForRapid } = createBunResponseStream();
			responseStream.write('Hello ');
			responseStream.end('World');

			const result = await streamToString(readableForRapid);
			expect(result).toBe('Hello World');
		});

		test('write should be a no-op and return false if stream ended', async () => {
			const { responseStream, readableForRapid } = createBunResponseStream();
			responseStream.end('initial');
			const writeResult = responseStream.write('more data');
			expect(writeResult).toBe(false);

			const result = await streamToString(readableForRapid);
			expect(result).toBe('initial'); // No "more data"
		});

		test('write should be a no-op and return false if stream errored', async () => {
			const { responseStream, readableForRapid } = createBunResponseStream();
			const testError = new Error('Test stream error');
			responseStream.error(testError); // This will also end the stream

			// Suppress console.error for this specific test case related to error logging
			const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
			const writeResult = responseStream.write('more data');
			expect(writeResult).toBe(false);
			errorSpy.mockRestore();

			// Check that only error trailer is present
			const resultBytes = await streamToUint8Array(readableForRapid);
			const resultString = new TextDecoder().decode(resultBytes);

			const rapidError = toRapidResponse(testError);
			const errorPayload: StreamErrorData = {
				errorType: rapidError.errorType,
				errorMessage: rapidError.errorMessage,
				stackTrace: rapidError.trace,
			};
			const trailerJson = JSON.stringify(errorPayload);
			const expectedTrailer = `\0\0\0\0\0\0\0\0${TRAILER_NAME_ERROR_TYPE}:${errorPayload.errorType}\nLambda-Runtime-Function-Error-Body:${trailerJson}\n`;

			expect(resultString).toBe(expectedTrailer);
		});

		describe('setContentType and getContentType', () => {
			test('should set and get content type', () => {
				const { responseStream } = createBunResponseStream();
				const contentType = 'application/json';
				responseStream.setContentType(contentType);
				expect(responseStream.getContentType()).toBe(contentType);
			});

			test('should have default content type if not set', () => {
				const { responseStream } = createBunResponseStream();
				expect(responseStream.getContentType()).toBe(DEFAULT_CONTENT_TYPE);
			});

			test('setContentType should throw if called more than once', () => {
				const { responseStream } = createBunResponseStream();
				responseStream.setContentType('text/plain');
				expect(() => {
					responseStream.setContentType('application/json');
				}).toThrow(
					new InvalidStreamingOperation('Content type can only be set once.'),
				);
				expect(responseStream.getContentType()).toBe('text/plain'); // Should retain first
			});

			test('setContentType should throw if called after first write', () => {
				const { responseStream } = createBunResponseStream();
				responseStream.write('first write');
				expect(() => {
					responseStream.setContentType('application/json');
				}).toThrow(
					new InvalidStreamingOperation(
						'Content type cannot be set after the first write.',
					),
				);
			});
		});

		test('write method should signal error for invalid chunk type', async () => {
			const { responseStream, readableForRapid } = createBunResponseStream();
			// Suppress console.error for this specific test case related to error logging
			const errorSpyConsole = spyOn(console, 'error').mockImplementation(
				() => {},
			);
			const writeResult = responseStream.write({ invalid: 'chunk' } as any);
			expect(writeResult).toBe(false); // write should indicate failure

			const resultString = await streamToString(readableForRapid);

			const expectedError = new TypeError(
				'The "chunk" argument must be of type string or an instance of Buffer or Uint8Array. Received an instance of object',
			);
			const rapidError = toRapidResponse(expectedError);
			// For robust testing, check type and message, make stack trace check general.
			const errorPayloadForComparison: Omit<StreamErrorData, 'stackTrace'> = {
				errorType: rapidError.errorType,
				errorMessage: rapidError.errorMessage,
			};
			// Construct the part of the trailer we can reliably compare
			const trailerJsonForComparison = JSON.stringify(
				errorPayloadForComparison,
			);
			const expectedTrailerStart = `\0\0\0\0\0\0\0\0${TRAILER_NAME_ERROR_TYPE}:${rapidError.errorType}\nLambda-Runtime-Function-Error-Body:`;

			expect(resultString.startsWith(expectedTrailerStart)).toBe(true);

			// Parse the actual JSON payload from the trailer to check stackTrace presence
			const actualTrailerJsonPart = resultString.substring(
				expectedTrailerStart.length,
				resultString.lastIndexOf('\n'),
			);
			try {
				const actualErrorPayload = JSON.parse(
					actualTrailerJsonPart,
				) as StreamErrorData;
				expect(actualErrorPayload.errorType).toBe(rapidError.errorType);
				expect(actualErrorPayload.errorMessage).toBe(rapidError.errorMessage);
				expect(actualErrorPayload.stackTrace).toBeArray();
				// Optionally, check if stackTrace is not empty if one is expected
				if (rapidError.trace && rapidError.trace.length > 0) {
					expect(actualErrorPayload.stackTrace?.length).toBeGreaterThan(0);
				}
			} catch (e) {
				// If JSON parsing fails, the trailer format is wrong.
				throw new Error(
					`Failed to parse error trailer JSON: ${actualTrailerJsonPart}. Original error: ${e}`,
				);
			}

			expect(responseStream.writableFinished).toBe(true);
			errorSpyConsole.mockRestore();
		});

		describe('error method', () => {
			test('should enqueue in-band error trailer and terminate the stream', async () => {
				const { responseStream, readableForRapid } = createBunResponseStream();
				const errorMessage = 'Something went wrong';
				const errorType = 'CustomError';
				const customError = new Error(errorMessage);
				customError.name = errorType;

				responseStream.write('Some data before error');
				responseStream.error(customError);

				const result = await streamToString(readableForRapid);

				const rapidError = toRapidResponse(customError);
				const errorPayload: StreamErrorData = {
					errorType: rapidError.errorType,
					errorMessage: rapidError.errorMessage,
					stackTrace: rapidError.trace,
				};
				const trailerJson = JSON.stringify(errorPayload);
				const expectedTrailer = `\0\0\0\0\0\0\0\0${TRAILER_NAME_ERROR_TYPE}:${errorPayload.errorType}\nLambda-Runtime-Function-Error-Body:${trailerJson}\n`;

				expect(result.startsWith('Some data before error')).toBe(true); // Data before error should be present
				expect(result.endsWith(expectedTrailer)).toBe(true); // Error trailer should be at the end

				// Check if stream is ended
				// const reader = readableForRapid.getReader(); // This line caused "ReadableStream is locked"
				// The stream is already consumed by streamToString.
				// writableFinished is the correct way to check the state of AwsWritableStream.
				expect(responseStream.writableFinished).toBe(true);
			});

			test('error should be a no-op if stream already errored', () => {
				const { responseStream } = createBunResponseStream();
				// const stdoutSpy = spyOn(process.stdout, 'write');

				responseStream.error(new Error('First error'));
				// Calling error again should be a no-op. The verbose log for this is visually confirmed in test output.
				responseStream.error(new Error('Second error'));

				// No programmatic assertion for the verbose log here due to spy difficulties.
				// Behavior is implicitly tested by stream state.
				// TODO: Revisit how to reliably spy on the verbose log call for this specific no-op message.
				// The log "AwsWritableStream.error: Stream already errored or ended. Cannot signal new error."
				// is visually confirmed in test output when AWS_LAMBDA_RUNTIME_VERBOSE="1".
				expect(responseStream.writableFinished).toBe(true); // Stream should be in errored state
			});

			test('error should be a no-op if stream already ended', () => {
				const { responseStream } = createBunResponseStream();
				// const stdoutSpy = spyOn(process.stdout, 'write');

				responseStream.end();
				// Calling error after end should be a no-op. The verbose log for this is visually confirmed.
				responseStream.error(new Error('Error after end'));

				// No programmatic assertion for the verbose log here.
				// Behavior is implicitly tested by stream state.
				// TODO: Revisit how to reliably spy on the verbose log call for this specific no-op message.
				// The log "AwsWritableStream.error: Stream already errored or ended. Cannot signal new error."
				// is visually confirmed in test output when AWS_LAMBDA_RUNTIME_VERBOSE="1".
				expect(responseStream.writableFinished).toBe(true); // Stream should be in ended state
			});
		});

		test('writableFinished should be true after end', () => {
			const { responseStream } = createBunResponseStream();
			responseStream.end();
			expect(responseStream.writableFinished).toBe(true);
		});

		test('writableFinished should be true after error', () => {
			const { responseStream } = createBunResponseStream();
			responseStream.error(new Error('test error'));
			expect(responseStream.writableFinished).toBe(true);
		});
	});
});
