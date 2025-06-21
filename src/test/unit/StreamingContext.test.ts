import * as BeforeExitListener from '../../pkg/BeforeExitListener.ts';
import { InvalidStreamingOperation } from '../../pkg/Errors.ts';
import {
	patchConsole,
	setCurrentRequestId,
	structuredConsole,
} from '../../pkg/LogPatch.ts';
import type RAPIDClient from '../../pkg/RAPIDClient.ts';
import {
	AwsWritableStream,
	DEFAULT_CONTENT_TYPE,
	HEADER_RESPONSE_MODE,
	VALUE_STREAMING,
} from '../../pkg/ResponseStream.ts';
import { build as buildStreamingContext } from '../../pkg/StreamingContext.ts';
import { consoleSnapshot } from './LoggingGlobals.ts'; // For restoring console
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	spyOn,
	test,
} from 'bun:test';

// Helper to consume a ReadableStream into a string
async function streamToString(
	stream: ReadableStream<Uint8Array>,
): Promise<string> {
	const reader = stream.getReader();
	let result = '';
	const decoder = new TextDecoder();
	while (true) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		if (value) {
			result += decoder.decode(value, { stream: true });
		}
	}
	result += decoder.decode(); // flush
	return result;
}

describe('StreamingContext', () => {
	let mockRapidClient: RAPIDClient;
	let mockPostInvocationResponse: ReturnType<typeof mock>;
	let mockScheduleNextIteration: ReturnType<typeof mock>;
	let mockBeforeExitListenerSet: ReturnType<typeof spyOn>;
	let mockBeforeExitListenerReset: ReturnType<typeof spyOn>;
	let mockStructuredConsoleLogError: ReturnType<typeof spyOn>;
	let mockConsoleError: ReturnType<typeof spyOn>; // New spy for console.error
	let restoreConsole: () => void;

	beforeEach(() => {
		restoreConsole = consoleSnapshot(); // Snapshot before patching
		patchConsole(); // Ensure console is patched for spies to work
		mockConsoleError = spyOn(console, 'error').mockImplementation(() => {}); // Spy on patched console.error
		// Create a mock RAPIDClient instance
		// We need to mock the methods that are called by StreamingContext
		mockPostInvocationResponse = mock(() => Promise.resolve());
		mockRapidClient = {
			postInvocationResponse: mockPostInvocationResponse,
		} as unknown as RAPIDClient; // Cast to RAPIDClient, only mocking used methods

		mockScheduleNextIteration = mock(() => {});
		mockBeforeExitListenerSet = spyOn(BeforeExitListener, 'set');
		mockBeforeExitListenerReset = spyOn(BeforeExitListener, 'reset');
		// Ensure structuredConsole.logError is a function before spying, if it can be undefined
		if (typeof structuredConsole.logError !== 'function') {
			structuredConsole.logError = () => {}; // Ensure it's a function
		}
		// Using 'as any' to bypass potential complex typing issues with spyOn and Partial types
		mockStructuredConsoleLogError = spyOn(
			structuredConsole as any,
			'logError',
		).mockImplementation(() => {});
	});

	afterEach(() => {
		mock.restore(); // Restores all bun mocks
		// It's good practice to restore spies on the original module/object if they were created
		// spyOn(BeforeExitListener, 'set').mockRestore(); // These are restored by mock.restore() if created by spyOn(object, method)
		// spyOn(BeforeExitListener, 'reset').mockRestore();
		if (mockStructuredConsoleLogError) {
			// mockStructuredConsoleLogError.mockRestore(); // This is if the spy itself has a mockRestore
			// If spyOn(obj, method) was used, mock.restore() should handle it.
			// However, explicit restoration can be safer if unsure.
			// For bun:test, mock.restore() should cover spies created with spyOn.
		}
		restoreConsole(); // Restore original console methods
		setCurrentRequestId(undefined); // Reset request ID
	});

	test('build should return a StreamingContextMembers object', () => {
		const context = buildStreamingContext(
			mockRapidClient,
			'invoke-id',
			mockScheduleNextIteration,
		);
		expect(context).toHaveProperty('callbackWaitsForEmptyEventLoop');
		expect(context).toHaveProperty('createStream');
		expect(typeof context.createStream).toBe('function');
	});

	test('callbackWaitsForEmptyEventLoop should default to true and be settable', () => {
		const context = buildStreamingContext(
			mockRapidClient,
			'invoke-id',
			mockScheduleNextIteration,
		);
		expect(context.callbackWaitsForEmptyEventLoop).toBe(true);
		context.callbackWaitsForEmptyEventLoop = false;
		expect(context.callbackWaitsForEmptyEventLoop).toBe(false);
	});

	describe('createStream', () => {
		test('should return CreatedStreamObjects with correct properties', () => {
			const context = buildStreamingContext(
				mockRapidClient,
				'invoke-id',
				mockScheduleNextIteration,
			);
			const streamObjects = context.createStream();

			expect(streamObjects.handlerResponseStream).toBeInstanceOf(
				AwsWritableStream,
			);
			expect(typeof streamObjects.fail).toBe('function');
			expect(typeof streamObjects.scheduleNext).toBe('function');
			// expect(streamObjects.rapidCallCompletionPromise).toBeInstanceOf(Promise); // Removed
			expect(typeof streamObjects.finalizeAndPostStream).toBe('function'); // Added
		});

		test('should throw InvalidStreamingOperation if called more than once', () => {
			const context = buildStreamingContext(
				mockRapidClient,
				'invoke-id',
				mockScheduleNextIteration,
			);
			context.createStream(); // First call
			expect(() => {
				context.createStream(); // Second call
			}).toThrow(InvalidStreamingOperation);
		});

		test('should call client.postInvocationResponse via finalizeAndPostStream with a correctly formed Response', async () => {
			const invokeId = 'test-invoke-id';
			const context = buildStreamingContext(
				mockRapidClient,
				invokeId,
				mockScheduleNextIteration,
			);
			const { handlerResponseStream, finalizeAndPostStream } =
				context.createStream();

			// Ensure the promise from finalizeAndPostStream (which calls postInvocationResponse) is handled
			await finalizeAndPostStream().catch(() => {});

			expect(mockPostInvocationResponse).toHaveBeenCalledTimes(1);
			const firstCallArgs = mockPostInvocationResponse.mock.calls[0];
			expect(firstCallArgs).toBeArray(); // Ensure it's an array
			if (!firstCallArgs)
				throw new Error(
					'Test Error: mockPostInvocationResponse was not called with arguments',
				);

			const [responseActual, calledInvokeIdActual, callbackActual] =
				firstCallArgs;

			expect(calledInvokeIdActual).toBe(invokeId);
			expect(responseActual).toBeInstanceOf(Response);
			expect(responseActual.headers.get(HEADER_RESPONSE_MODE)).toBe(
				VALUE_STREAMING,
			);
			expect(typeof callbackActual).toBe('function');

			// Check the body (streamWithPrelude)
			// This involves HttpResponseStream.from and the prelude logic
			const expectedContentType = DEFAULT_CONTENT_TYPE; // Default from AwsWritableStream
			const prelude = {
				statusCode: 200,
				cookies: [], // Added default from finalizeAndPostStream
				headers: { 'content-type': expectedContentType },
			};
			const jsonPrelude = JSON.stringify(prelude);
			const delimiter = new TextDecoder().decode(new Uint8Array(8)); // 8 null bytes

			// Write some data to the handler stream to test the full flow
			const testData = 'test data';
			handlerResponseStream.write(testData);
			handlerResponseStream.end();

			const bodyStream = responseActual.body as ReadableStream<Uint8Array>; // Use responseActual
			const bodyString = await streamToString(bodyStream);

			expect(bodyString).toBe(jsonPrelude + delimiter + testData);
		});

		test('should use handler-set content type in prelude via finalizeAndPostStream', async () => {
			const context = buildStreamingContext(
				mockRapidClient,
				'test-invoke-id',
				mockScheduleNextIteration,
			);
			const { handlerResponseStream, finalizeAndPostStream } =
				context.createStream();

			const customContentType = 'application/json';
			handlerResponseStream.setContentType(customContentType);
			// No data written, just ending the stream from handler's perspective
			handlerResponseStream.end();

			// Now finalize and post, this is when the prelude should be constructed with the latest content type
			await finalizeAndPostStream().catch(() => {});

			expect(mockPostInvocationResponse).toHaveBeenCalledTimes(1);
			const callArgs = mockPostInvocationResponse.mock.calls[0];
			if (!callArgs || !Array.isArray(callArgs)) {
				throw new Error(
					'Test Error: mockPostInvocationResponse was not called as expected',
				);
			}
			const [responseObjectFromMock, _] = callArgs;

			const prelude = {
				statusCode: 200, // Default from finalizeAndPostStream
				cookies: [], // Default from finalizeAndPostStream
				headers: { 'content-type': customContentType },
			};
			const jsonPrelude = JSON.stringify(prelude);
			const delimiter = new TextDecoder().decode(new Uint8Array(8)); // 8 null bytes

			const bodyStream =
				responseObjectFromMock.body as ReadableStream<Uint8Array>;
			const bodyString = await streamToString(bodyStream);

			// Since handlerResponseStream.end() was called without data, only prelude and delimiter are expected.
			expect(bodyString).toBe(jsonPrelude + delimiter);
		});
	});

	describe('CreatedStreamObjects.scheduleNext', () => {
		test('should call BeforeExitListener.reset and scheduleNextIteration when callbackWaitsForEmptyEventLoop is false', () => {
			const context = buildStreamingContext(
				mockRapidClient,
				'invoke-id',
				mockScheduleNextIteration,
			);
			context.callbackWaitsForEmptyEventLoop = false;
			const streamObjects = context.createStream();
			streamObjects.scheduleNext();

			expect(mockBeforeExitListenerReset).toHaveBeenCalledTimes(1);
			expect(mockScheduleNextIteration).toHaveBeenCalledTimes(1);
			expect(mockBeforeExitListenerSet).not.toHaveBeenCalled();
		});

		test('should call BeforeExitListener.reset and BeforeExitListener.set when callbackWaitsForEmptyEventLoop is true', (done) => {
			const context = buildStreamingContext(
				mockRapidClient,
				'invoke-id',
				mockScheduleNextIteration,
			);
			expect(context.callbackWaitsForEmptyEventLoop).toBe(true); // Default
			const streamObjects = context.createStream();

			mockBeforeExitListenerSet.mockImplementation((fn: () => void) => {
				expect(mockBeforeExitListenerReset).toHaveBeenCalledTimes(1);
				// fn contains setImmediate(() => scheduleNextIteration())
				// We can call fn to simulate the beforeExit event.
				fn();
				return {} as any; // Return dummy listener
			});

			mockScheduleNextIteration.mockImplementation(() => {
				done(); // Async test completion
			});

			streamObjects.scheduleNext();
		});
	});

	describe('CreatedStreamObjects.fail', () => {
		// Note: The 'fail' method's role has changed. It primarily signals an error on the handler's
		// stream and calls scheduleNextCb. The actual posting is now done by Runtime calling finalizeAndPostStream.
		test('should call handlerResponseStream.error and scheduleNextCb', async () => {
			const context = buildStreamingContext(
				mockRapidClient,
				'invoke-id',
				mockScheduleNextIteration,
			);
			const { handlerResponseStream, fail, finalizeAndPostStream } =
				context.createStream();
			const errorSpy = spyOn(handlerResponseStream, 'error');
			const testError = new Error('Test failure from fail method');

			// Simulate Runtime: 1. call fail, 2. then finalizeAndPostStream
			await fail(testError, mockScheduleNextIteration);
			// finalizeAndPostStream would typically be called by Runtime after this
			// For this test, we are only testing the direct responsibilities of 'fail'

			expect(mockStructuredConsoleLogError).toHaveBeenCalledWith(
				'StreamingContext.fail: Invoke Error reported to StreamingContext',
				testError,
			);
			expect(errorSpy).toHaveBeenCalledWith(testError);
			expect(mockScheduleNextIteration).toHaveBeenCalledTimes(1); // scheduleNextCb is called by fail
		});

		test('finalizeAndPostStream should propagate errors from client.postInvocationResponse', async () => {
			const rapidError = new Error('RAPID call failed during finalize');
			mockPostInvocationResponse.mockRejectedValue(rapidError);

			const context = buildStreamingContext(
				mockRapidClient,
				'invoke-id',
				mockScheduleNextIteration,
			);
			const { finalizeAndPostStream } = context.createStream();

			await expect(finalizeAndPostStream()).rejects.toThrow(rapidError);

			expect(mockStructuredConsoleLogError).toHaveBeenCalledWith(
				'StreamingContext.finalizeAndPostStream: Error posting invocation response to RAPID',
				rapidError,
			);
		});
	});
});
