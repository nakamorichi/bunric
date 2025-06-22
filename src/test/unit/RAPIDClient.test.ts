/**
 * Copyright 2024 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 */

// Import InvocationError from BunRapidClient where it's defined
import type { InvocationError } from '../../pkg/BunRapidClient.ts';
import * as Errors from '../../pkg/Errors.ts';
import RAPIDClient from '../../pkg/RAPIDClient.ts';
import { beforeEach, describe, expect, it, mock } from 'bun:test';

// Mock the BunRapidClient class
// We want to inspect what RAPIDClient passes to BunRapidClient's methods
// Ensure mock signatures match the actual BunRapidClient methods
const mockPostInvocationError = mock(
	(_id: string, _errorData: InvocationError) => Promise.resolve(),
);
const mockPostInitError = mock((_errorData: InvocationError) =>
	Promise.resolve(),
);
const mockPostInvocationResponse = mock(
	(_id: string, _result: any, _contentType?: string) => Promise.resolve(),
);
const mockNextInvocation = mock(() =>
	Promise.resolve({
		invocationId: 'mock-id',
		response: {},
		deadlineMs: Date.now() + 1000,
		invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test',
		contentType: 'application/json',
		// Ensure all fields from InvocationResponse in BunRapidClient.ts are here if needed by RAPIDClient
	}),
);

mock.module('../../pkg/BunRapidClient.ts', () => ({
	BunRapidClient: class {
		constructor() {}
		postInvocationError = mockPostInvocationError;
		postInitError = mockPostInitError;
		postInvocationResponse = mockPostInvocationResponse;
		nextInvocation = mockNextInvocation;
	},
}));

class EvilError extends Error {
	constructor(message: string) {
		super(message);
		// Ensure the name property is set correctly for Error instances.
		// The key to getting "handled" from toRapidResponse is for an error to occur
		// *during* the processing within toRapidResponse's try block.
		// The original EvilError achieved this by making `err.name` throw.
		// We can replicate this by defining a getter for 'name' that throws.
		Object.defineProperty(this, 'name', {
			get() {
				throw new Error('Simulated access error for EvilError.name');
			},
		});
		// To be absolutely sure toRapidResponse's try block fails,
		// we can also make another accessed property problematic.
		// Object.defineProperty(this, 'message', {
		//   get() {
		//     throw new Error('Simulated access error for EvilError.message');
		//   }
		// });
	}
}

const EXPECTED_ERROR_HEADER_NAME = 'Lambda-Runtime-Function-Error-Type';

describe('RAPIDClient with mocked BunRapidClient', () => {
	let client: RAPIDClient;

	beforeEach(() => {
		// Reset mocks before each test
		mockPostInvocationError.mockClear();
		mockPostInitError.mockClear();
		mockPostInvocationResponse.mockClear();
		mockNextInvocation.mockClear();

		// Instantiate RAPIDClient, which will use the mocked BunRapidClient
		// The constructor argument for RAPIDClient is now optional and not used for hostname/port
		client = new RAPIDClient();
	});

	const errorTestCases: [Error | { data: string }, string][] = [
		[new Error('generic failure'), 'Error'],
		[
			new Errors.ImportModuleError('import module error'),
			'Runtime.ImportModuleError',
		],
		[
			new Errors.HandlerNotFound('handler not found'),
			'Runtime.HandlerNotFound',
		],
		[
			new Errors.MalformedHandlerName('malformed handler'),
			'Runtime.MalformedHandlerName',
		],
		[
			new Errors.UserCodeSyntaxError('syntax error'),
			'Runtime.UserCodeSyntaxError',
		],
		// The old test had { data: 'some random object' } which toRapidResponse converts to 'object' type
		// Let's test with an actual non-Error object to see how toRapidResponse handles it
		[{ data: 'some random object' } as any, 'object'],
		[new EvilError('evil error') as Error, 'handled'], // 'handled' is the fallback from toRapidResponse
	];

	describe('postInitError', () => {
		errorTestCases.forEach(([errorInput, expectedErrorType]) => {
			it(`should call BunRapidClient.postInitError with errorType '${expectedErrorType}' for ${errorInput?.constructor?.name || typeof errorInput}`, async () => {
				const dummyCallback = () => {};
				// Cast errorInput to Error for the method call, toRapidResponse handles non-Error types internally.
				await client.postInitError(errorInput as Error, dummyCallback);

				expect(mockPostInitError).toHaveBeenCalledTimes(1);
				if (mockPostInitError.mock.calls.length > 0) {
					const calledWithError = mockPostInitError.mock.calls[0]?.[0];
					expect(calledWithError).toHaveProperty(
						'errorType',
						expectedErrorType,
					);
				}
			});
		});
	});

	describe('postInvocationError', () => {
		errorTestCases.forEach(([errorInput, expectedErrorType]) => {
			it(`should call BunRapidClient.postInvocationError with errorType '${expectedErrorType}' for ${errorInput?.constructor?.name || typeof errorInput}`, async () => {
				const requestId = 'test-invocation-id';
				const dummyCallback = () => {};
				// Cast errorInput to Error for the method call
				await client.postInvocationError(
					errorInput as Error,
					requestId,
					dummyCallback,
				);

				expect(mockPostInvocationError).toHaveBeenCalledTimes(1);
				if (mockPostInvocationError.mock.calls.length > 0) {
					const firstCallArgs = mockPostInvocationError.mock.calls[0];
					if (firstCallArgs) {
						expect(firstCallArgs[0]).toBe(requestId); // Verify request ID
						expect(firstCallArgs[1]).toHaveProperty(
							'errorType',
							expectedErrorType,
						);
					}
				}
			});
		});
	});

	// The tests for request ID encoding were specific to the native client's separate arguments.
	// BunRapidClient builds the URL with the requestId directly.
	// We can test this by checking the URL passed to the mocked `fetch` if we were mocking fetch.
	// Since we are mocking BunRapidClient itself, we assume BunRapidClient handles URL encoding correctly.
	// If we want to test RAPIDClient's role in passing the ID, we can check the ID argument.
	describe('request ID handling (passed to BunRapidClient)', () => {
		const testIds = [
			['#', '#'], // encodeURIComponent does not encode # unless it's part of query string. Path part is fine.
			['%', '%'], // encodeURIComponent encodes % to %25
			['/', '/'], // encodeURIComponent does not encode /
			['?', '?'], // encodeURIComponent does not encode ?
			['\x7F', '\x7F'],
			["<script>alert('1')</script>", "<script>alert('1')</script>"],
			['⚡', '⚡'],
			['.', '.'],
			['..', '..'],
			['a', 'a'],
			[
				'59b22c65-fa81-47fb-a6dc-23028a63566f',
				'59b22c65-fa81-47fb-a6dc-23028a63566f',
			],
		];

		testIds.forEach(([requestIdParam, _expectedEncodedId]) => {
			if (typeof requestIdParam !== 'string') {
				// This case should ideally not happen based on testIds definition
				throw new Error(
					`Test setup error: requestIdParam is not a string: ${requestIdParam}`,
				);
			}
			const requestId: string = requestIdParam;
			it(`postInvocationResponse should pass requestId '${requestId}' to BunRapidClient`, async () => {
				await client.postInvocationResponse({}, requestId, () => {});
				expect(mockPostInvocationResponse).toHaveBeenCalledTimes(1);
				const calls = mockPostInvocationResponse.mock.calls;
				if (calls.length > 0 && calls[0] !== undefined) {
					expect(calls[0][0]).toBe(requestId);
				}
			});

			it(`postInvocationError should pass requestId '${requestId}' to BunRapidClient`, async () => {
				await client.postInvocationError(
					new Error('test error'),
					requestId,
					() => {},
				);
				expect(mockPostInvocationError).toHaveBeenCalledTimes(1);
				const calls = mockPostInvocationError.mock.calls;
				if (calls.length > 0 && calls[0] !== undefined) {
					expect(calls[0][0]).toBe(requestId);
				}
			});
		});
	});
});
