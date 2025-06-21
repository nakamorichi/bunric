/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *
 * This module defines the BunRapidClient.
 * It's responsible for all HTTP communication with the Lambda Runtime API (RAPID)
 * using Bun.fetch().
 */

const RUNTIME_PATH_PREFIX = '/2018-06-01/runtime';
const BASE_RUNTIME_API_URL = `http://${process.env.AWS_LAMBDA_RUNTIME_API}`;
const USER_AGENT = `aws-lambda-ric/bun (Bun/${Bun.version})`;

export interface InvocationResponse {
	invocationId: string;
	response: unknown; // Can be any JSON-serializable type or a Response object for streaming
	error?: Error; // For internal client errors, not handler errors
	deadlineMs: number;
	invokedFunctionArn: string;
	clientContext?: Record<string, any>;
	cognitoIdentity?: Record<string, any>;
	contentType: string;
}

export interface InvocationError {
	errorType: string;
	errorMessage: string;
	stackTrace?: string[];
	errorFields?: Record<string, any>; // For additional structured error data
}

export class BunRapidClient {
	private readonly baseUrl: string;

	constructor(runtimeApiUrl = BASE_RUNTIME_API_URL) {
		this.baseUrl = runtimeApiUrl;
	}

	/**
	 * Gets the next invocation event from the Lambda Runtime API.
	 * @returns {Promise<InvocationResponse>}
	 */
	async nextInvocation(): Promise<InvocationResponse> {
		const url = `${this.baseUrl}${RUNTIME_PATH_PREFIX}/invocation/next`;
		console.debug('BunRapidClient: nextInvocation - Calling GET', url);

		try {
			const response = await fetch(url, {
				method: 'GET',
				headers: {
					'User-Agent': USER_AGENT,
				},
			});

			console.debug(
				'BunRapidClient: nextInvocation - Response status:',
				response.status,
			);

			if (!response.ok) {
				const errorBody = await response.text();
				console.error(
					'BunRapidClient: nextInvocation - Failed to get next invocation:',
					response.status,
					errorBody,
				);
				throw new Error(
					`Failed to get next invocation: ${response.status} ${errorBody}`,
				);
			}

			const invocationId =
				response.headers.get('lambda-runtime-aws-request-id') || '';
			const deadlineMs = Number.parseInt(
				response.headers.get('lambda-runtime-deadline-ms') || '0',
				10,
			);
			const invokedFunctionArn =
				response.headers.get('lambda-runtime-invoked-function-arn') || '';
			const clientContextHeader = response.headers.get(
				'lambda-runtime-client-context',
			);
			const cognitoIdentityHeader = response.headers.get(
				'lambda-runtime-cognito-identity',
			);
			const contentType =
				response.headers.get('content-type') || 'application/json';

			let clientContext: any;
			if (clientContextHeader) {
				try {
					clientContext = JSON.parse(clientContextHeader);
				} catch (e) {
					console.warn(
						'BunRapidClient: nextInvocation - Failed to parse client context JSON:',
						e,
					);
				}
			}

			let cognitoIdentity: any;
			if (cognitoIdentityHeader) {
				try {
					cognitoIdentity = JSON.parse(cognitoIdentityHeader);
				} catch (e) {
					console.warn(
						'BunRapidClient: nextInvocation - Failed to parse cognito identity JSON:',
						e,
					);
				}
			}

			// The body itself is the event payload for the handler
			const eventPayload = await response.json();

			return {
				invocationId,
				response: eventPayload,
				deadlineMs,
				invokedFunctionArn,
				clientContext,
				cognitoIdentity,
				contentType,
			};
		} catch (error) {
			console.error(
				'BunRapidClient: nextInvocation - Error fetching next invocation:',
				error,
			);
			// This is a client-side error, not a handler error.
			// The main loop should probably post this to /runtime/init/error if it happens during init,
			// or handle it as a fatal runtime error.
			return {
				invocationId: '',
				response: null,
				error: error instanceof Error ? error : new Error(String(error)),
				deadlineMs: 0,
				invokedFunctionArn: '',
				contentType: 'application/json',
			};
		}
	}

	/**
	 * Posts a successful invocation response to the Lambda Runtime API.
	 * @param {string} invocationId - The ID of the invocation.
	 * @param {unknown} result - The result of the function invocation. Can be any JSON-serializable type or a Response object for streaming.
	 * @param {string} [contentType='application/json'] - The content type of the response.
	 * @returns {Promise<void>}
	 */
	async postInvocationResponse(
		invocationId: string,
		result: unknown,
		contentType: string = 'application/json',
	): Promise<void> {
		const url = `${this.baseUrl}${RUNTIME_PATH_PREFIX}/invocation/${invocationId}/response`;
		console.debug('BunRapidClient: postInvocationResponse - Calling POST', url);

		let body: BodyInit | null | undefined;
		const headers: HeadersInit = {
			'User-Agent': USER_AGENT,
			'Content-Type': contentType,
		};

		if (result instanceof Response) {
			// Streaming response
			// Lambda requires specific headers for streaming
			headers['Lambda-Runtime-Function-Response-Mode'] = 'streaming';
			headers['Transfer-Encoding'] = 'chunked';
			// The Content-Type for the prelude is application/vnd.awslambda.http-integration-response
			// The actual handler's response Content-Type will be part of the prelude.
			// For now, we assume the `contentType` parameter is for the prelude if streaming.
			// This might need refinement based on how HttpResponseStream is adapted.
			body = result.body;
		} else {
			// Buffered response
			try {
				body = JSON.stringify(result);
			} catch (error) {
				console.error(
					'BunRapidClient: postInvocationResponse - Failed to stringify result:',
					error,
				);
				// This is a serialization error, should be posted to /error endpoint
				// For now, rethrow and let the caller handle it, or post to /error directly.
				// This specific case might need to be handled by posting an error to the /error endpoint.
				throw error;
			}
		}

		try {
			const response = await fetch(url, {
				method: 'POST',
				headers,
				body,
			});

			console.debug(
				'BunRapidClient: postInvocationResponse - Response status:',
				response.status,
			);

			if (!response.ok) {
				const errorBody = await response.text();
				console.error(
					'BunRapidClient: postInvocationResponse - Failed to post invocation response:',
					response.status,
					errorBody,
				);
				// This indicates an issue with the RAPID API itself or our request.
				// The runtime should probably treat this as a fatal error.
				throw new Error(
					`Failed to post invocation response: ${response.status} ${errorBody}`,
				);
			}
			// Successfully posted, response body is usually empty or not relevant for success.
			await response.text(); // Consume the body to free resources
		} catch (error) {
			console.error(
				'BunRapidClient: postInvocationResponse - Error posting invocation response:',
				error,
			);
			throw error; // Rethrow for the main loop to handle, potentially as a fatal runtime error.
		}
	}

	/**
	 * Posts an invocation error to the Lambda Runtime API.
	 * @param {string} invocationId - The ID of the invocation.
	 * @param {InvocationError} errorData - The error data to post.
	 * @returns {Promise<void>}
	 */
	async postInvocationError(
		invocationId: string,
		errorData: InvocationError,
	): Promise<void> {
		const url = `${this.baseUrl}${RUNTIME_PATH_PREFIX}/invocation/${invocationId}/error`;
		console.debug('BunRapidClient: postInvocationError - Calling POST', url);

		const body = JSON.stringify(errorData);

		try {
			const response = await fetch(url, {
				method: 'POST',
				headers: {
					'User-Agent': USER_AGENT,
					'Content-Type': 'application/json',
					'Lambda-Runtime-Function-Error-Type': errorData.errorType,
				},
				body,
			});

			console.debug(
				'BunRapidClient: postInvocationError - Response status:',
				response.status,
			);

			if (!response.ok) {
				const errorBody = await response.text();
				console.error(
					'BunRapidClient: postInvocationError - Failed to post invocation error:',
					response.status,
					errorBody,
				);
				throw new Error(
					`Failed to post invocation error: ${response.status} ${errorBody}`,
				);
			}
			await response.text(); // Consume the body
		} catch (error) {
			console.error(
				'BunRapidClient: postInvocationError - Error posting invocation error:',
				error,
			);
			throw error;
		}
	}

	/**
	 * Posts an initialization error to the Lambda Runtime API.
	 * This is used for errors that occur during the customer's code initialization.
	 * @param {InvocationError} errorData - The error data to post.
	 * @returns {Promise<void>}
	 */
	async postInitError(errorData: InvocationError): Promise<void> {
		const url = `${this.baseUrl}${RUNTIME_PATH_PREFIX}/init/error`;
		console.debug('BunRapidClient: postInitError - Calling POST', url);

		const body = JSON.stringify(errorData);

		try {
			const response = await fetch(url, {
				method: 'POST',
				headers: {
					'User-Agent': USER_AGENT,
					'Content-Type': 'application/json',
					'Lambda-Runtime-Function-Error-Type': errorData.errorType,
				},
				body,
			});

			console.debug(
				'BunRapidClient: postInitError - Response status:',
				response.status,
			);

			if (!response.ok) {
				const errorBody = await response.text();
				console.error(
					'BunRapidClient: postInitError - Failed to post init error:',
					response.status,
					errorBody,
				);
				// This is a critical failure, the runtime will likely be shut down by Lambda.
				throw new Error(
					`Failed to post init error: ${response.status} ${errorBody}`,
				);
			}
			await response.text(); // Consume the body
		} catch (error) {
			console.error(
				'BunRapidClient: postInitError - Error posting init error:',
				error,
			);
			// If posting the init error fails, there's not much else we can do.
			// Log it and rethrow. The Lambda service will likely terminate the environment.
			throw error;
		}
	}
}
