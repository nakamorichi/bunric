/**
 * Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *
 * This module defines the RAPID client which is responsible for all HTTP
 * interactions with the RAPID layer.
 */

// BunRapidClient will be imported as an ES module if this file is converted to .ts or if used in an ESM context
// For now, assuming it might be required in a CJS context temporarily, will adjust import later.
// const { BunRapidClient } = require('./BunRapidClient'); // Placeholder if CJS require is needed
import { BunRapidClient } from './BunRapidClient.ts'; // Preferred ESM import
import * as Errors from './Errors.ts';

// import { createResponseStream } from './ResponseStream.js'; // To be refactored

/**
 * Objects of this class are responsible for all interactions with the RAPID
 * API, now using BunRapidClient.
 */
export default class RAPIDClient {
	private client: BunRapidClient;

	constructor(hostnamePort?: string) {
		// hostnamePort is optional now, make it explicit
		// hostnamePort is now implicitly handled by BunRapidClient via AWS_LAMBDA_RUNTIME_API env var
		this.client = new BunRapidClient();
	}

	/**
	 * Complete an invocation with the provided response.
	 * @param {Object} response
	 *   An arbitrary object to convert to JSON and send back as as response.
	 * @param {String} id
	 *   The invocation ID.
	 * @param {Function} callback
	 *   The callback to run after the POST response ends
	 */
	async postInvocationResponse(
		response: unknown,
		id: string,
		callback?: (err?: Error | null) => void,
	) {
		// BunRapidClient handles serialization and content type internally for non-streaming
		// For streaming, the 'response' would be a Response object.
		try {
			await this.client.postInvocationResponse(id, response);
			if (callback) callback();
		} catch (err) {
			// Errors from BunRapidClient are already logged.
			// The runtime loop will need to decide how to handle this failure.
			// Potentially pass error to callback or let it propagate if callback isn't designed for errors.
			console.error(
				'RAPIDClient: Error in postInvocationResponse, propagating or calling callback with error if applicable',
				err,
			);
			if (callback) {
				if (err instanceof Error) {
					callback(err);
				} else {
					callback(new Error(String(err)));
				}
			} else throw err;
		}
	}

	/**
	 * Stream the invocation response.
	 * @param {String} id
	 *   The invocation ID.
	 * @param {Function} callback
	 *   The callback to run after the POST response ends
	 * @return {object}
	 *   A response stream and a Promise that resolves when the stream is done.
	 */
	getStreamForInvocationResponse(
		id: string,
		callback?: (err?: Error | null) => void,
		options?: { highWaterMark?: number },
	) {
		// TODO: Refactor streaming. This current implementation is Node.js http specific.
		// BunRapidClient's postInvocationResponse will handle Response objects for streaming.
		// This method will need to be re-thought to integrate with HttpResponseStream.js and ResponseStream.js
		// or be replaced by a mechanism that directly provides a Writable stream that pipes to Bun.fetch.
		console.warn(
			'getStreamForInvocationResponse is not yet fully adapted for Bun and needs refactoring.',
		);
		throw new Error(
			'getStreamForInvocationResponse needs to be refactored for Bun.',
		);
		/*
    const ret = createResponseStream({
      httpOptions: {
        agent: this.agent, // this.agent is removed
        http: this.http, // this.http is removed
        hostname: this.hostname, // this.hostname is removed
        method: 'POST',
        port: this.port, // this.port is removed
        path:
          '/2018-06-01/runtime/invocation/' +
          encodeURIComponent(id) +
          '/response',
        highWaterMark: options?.highWaterMark,
      },
    });

    return {
      request: ret.request,
      responseDone: ret.responseDone.then((_) => {
        if (callback) {
          callback();
        }
      }),
    };
    */
	}

	/**
	 * Post an initialization error to the RAPID API.
	 * @param {Error} error
	 * @param {Function} callback
	 *   The callback to run after the POST response ends
	 */
	async postInitError(error: Error, callback?: (err?: Error | null) => void) {
		const errorResponse = Errors.toRapidResponse(error);
		try {
			await this.client.postInitError(errorResponse);
			if (callback) callback();
		} catch (err) {
			console.error('RAPIDClient: Error in postInitError', err);
			if (callback) {
				if (err instanceof Error) {
					callback(err);
				} else {
					callback(new Error(String(err)));
				}
			} else throw err;
		}
	}

	/**
	 * Post an invocation error to the RAPID API
	 * @param {Error} error
	 * @param {String} id
	 *   The invocation ID for the in-progress invocation.
	 * @param {Function} callback
	 *   The callback to run after the POST response ends
	 */
	async postInvocationError(
		error: Error,
		id: string,
		callback?: (err?: Error | null) => void,
	) {
		const errorResponse = Errors.toRapidResponse(error);
		// Note: XRayErrorFormatter.formatted(error) was used with nativeClient.error.
		// BunRapidClient's postInvocationError currently only takes the structured error.
		// If X-Ray formatted error needs to be part of the payload or a specific header,
		// BunRapidClient or this method needs adjustment. For now, we pass the structured error.
		// The 'Lambda-Runtime-Function-Error-Type' header is set by BunRapidClient.
		try {
			await this.client.postInvocationError(id, errorResponse);
			if (callback) callback();
		} catch (err) {
			console.error('RAPIDClient: Error in postInvocationError', err);
			if (callback) {
				if (err instanceof Error) {
					callback(err);
				} else {
					callback(new Error(String(err)));
				}
			} else throw err;
		}
	}

	/**
	 * Get the next invocation.
	 * @return {Promise<Object>}
	 *   A promise which resolves to an invocation object that contains the event payload (response.response)
	 *   and other invocation details (invocationId, deadlineMs, etc.).
	 */
	async nextInvocation() {
		const invocationData = await this.client.nextInvocation();
		if (invocationData.error) {
			// This indicates a client-side error in BunRapidClient when fetching next invocation
			throw invocationData.error;
		}
		// Adapt the returned structure to what the Runtime.js expects,
		// which was previously { bodyJson, headers }.
		// BunRapidClient returns a more structured object.
		// Runtime.js will need to be adapted to use invocationData.response as the event,
		// and invocationData.invocationId, etc., directly.
		// For now, let's try to match the old structure somewhat, though this will need review.
		return {
			bodyJson: invocationData.response, // This is already parsed JSON by BunRapidClient
			headers: {
				// Reconstruct a headers-like object for compatibility, if needed by Runtime.js
				'lambda-runtime-aws-request-id': invocationData.invocationId,
				'lambda-runtime-deadline-ms': String(invocationData.deadlineMs),
				'lambda-runtime-invoked-function-arn':
					invocationData.invokedFunctionArn,
				'lambda-runtime-client-context': invocationData.clientContext
					? JSON.stringify(invocationData.clientContext)
					: undefined,
				'lambda-runtime-cognito-identity': invocationData.cognitoIdentity
					? JSON.stringify(invocationData.cognitoIdentity)
					: undefined,
				'content-type': invocationData.contentType,
			},
			// Pass through the full structured data as well for easier adaptation later
			_rawInvocationData: invocationData,
		};
	}
}

// _trySerializeResponse is no longer needed here as BunRapidClient handles serialization.
/*
function _trySerializeResponse(body) {
  try {
    return JSON.stringify(body === undefined ? null : body);
  } catch (err) {
    throw new Error('Unable to stringify response body');
  }
}
*/
