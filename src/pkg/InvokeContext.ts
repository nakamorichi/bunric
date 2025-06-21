/**
 * Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *
 * This module defines the InvokeContext and supporting functions. The
 * InvokeContext is responsible for pulling information from the invoke headers
 * and for wrapping the Rapid Client object's error and response functions.
 */

import assert from 'node:assert';

import { setCurrentRequestId, setCurrentTenantId } from './LogPatch.ts';
import type { Poolable } from './utils/ObjectPool.ts';

const INVOKE_HEADER = {
	ClientContext: 'lambda-runtime-client-context',
	CognitoIdentity: 'lambda-runtime-cognito-identity',
	ARN: 'lambda-runtime-invoked-function-arn',
	AWSRequestId: 'lambda-runtime-aws-request-id',
	DeadlineMs: 'lambda-runtime-deadline-ms',
	XRayTrace: 'lambda-runtime-trace-id',
	TenantId: 'lambda-runtime-aws-tenant-id',
} as const; // Use "as const" for stricter typing of keys

type InvokeHeaderKeys = (typeof INVOKE_HEADER)[keyof typeof INVOKE_HEADER];
type Headers = Record<InvokeHeaderKeys | string, string | undefined>; // Allow other string keys too

interface EnvironmentalData {
	functionVersion?: string;
	functionName?: string;
	memoryLimitInMB?: string;
	logGroupName?: string;
	logStreamName?: string;
}

interface HeaderData {
	clientContext?: any;
	identity?: any;
	invokedFunctionArn?: string;
	awsRequestId?: string;
	tenantId?: string;
	getRemainingTimeInMillis: () => number;
}

export default class InvokeContext implements Poolable {
	private headers: Headers;

	constructor(headers: Record<string, string | undefined> = {}) {
		this.headers = _enforceLowercaseKeys(headers);
	}

	/**
	 * Initialize the context with new headers (for object pooling)
	 */
	initialize(headers: Record<string, string | undefined>): void {
		this.headers = _enforceLowercaseKeys(headers);
	}

	/**
	 * Reset the context for object pooling
	 */
	reset(): void {
		this.headers = {};
	}

	/**
	 * The invokeId for this request.
	 */
	get invokeId(): string {
		const id = this.headers[INVOKE_HEADER.AWSRequestId];
		assert.ok(id, 'invocation id is missing or invalid');
		return id!; // Not null due to assert
	}

	/**
	 * The tenantId for this request.
	 */
	get tenantId(): string | undefined {
		return this.headers[INVOKE_HEADER.TenantId];
	}

	/**
	 * Push relevant invoke data into the logging context.
	 */
	updateLoggingContext(): void {
		setCurrentRequestId(this.invokeId);
		setCurrentTenantId(this.tenantId);
	}

	/**
	 * Attach all of the relavant environmental and invocation data to the
	 * provided object.
	 * This method can throw if the headers are malformed and cannot be parsed.
	 * @param callbackContext {Object}
	 *   The callbackContext object returned by a call to buildCallbackContext().
	 * @return {Object}
	 *   The user context object with all required data populated from the headers
	 *   and environment variables.
	 */
	attachEnvironmentData(callbackContext: any): any {
		this._forwardXRay();
		return Object.assign(
			callbackContext,
			this._environmentalData(),
			this._headerData(),
		);
	}

	/**
	 * All parts of the user-facing context object which are provided through
	 * environment variables.
	 */
	private _environmentalData(): EnvironmentalData {
		return {
			functionVersion: process.env.AWS_LAMBDA_FUNCTION_VERSION,
			functionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
			memoryLimitInMB: process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE,
			logGroupName: process.env.AWS_LAMBDA_LOG_GROUP_NAME,
			logStreamName: process.env.AWS_LAMBDA_LOG_STREAM_NAME,
		};
	}

	/**
	 * All parts of the user-facing context object which are provided through
	 * request headers.
	 */
	private _headerData(): HeaderData {
		const deadlineHeader = this.headers[INVOKE_HEADER.DeadlineMs];
		const deadline = deadlineHeader
			? Number.parseInt(deadlineHeader, 10)
			: Date.now() + 3000; // Default if missing, though should always be present

		return {
			clientContext: _parseJson(
				this.headers[INVOKE_HEADER.ClientContext]?.trim() === ''
					? undefined
					: this.headers[INVOKE_HEADER.ClientContext],
				'ClientContext',
			),
			identity: _parseJson(
				this.headers[INVOKE_HEADER.CognitoIdentity]?.trim() === ''
					? undefined
					: this.headers[INVOKE_HEADER.CognitoIdentity],
				'CognitoIdentity',
			),
			invokedFunctionArn: this.headers[INVOKE_HEADER.ARN],
			awsRequestId: this.headers[INVOKE_HEADER.AWSRequestId],
			tenantId: this.headers[INVOKE_HEADER.TenantId],
			getRemainingTimeInMillis: (): number => deadline - Date.now(),
		};
	}

	/**
	 * Forward the XRay header into the environment variable.
	 */
	private _forwardXRay(): void {
		const traceId = this.headers[INVOKE_HEADER.XRayTrace];
		if (traceId) {
			process.env._X_AMZN_TRACE_ID = traceId;
		} else {
			delete process.env._X_AMZN_TRACE_ID;
		}
	}
}

/**
 * Parse a JSON string and throw a readable error if something fails.
 */
function _parseJson(
	jsonString: string | undefined,
	name: string,
): any | undefined {
	if (jsonString !== undefined) {
		try {
			return JSON.parse(jsonString);
		} catch (err) {
			// err is 'unknown' type in catch, cast to Error
			const error = err as Error;
			throw new Error(`Cannot parse ${name} as json: ${error.toString()}`);
		}
	} else {
		return undefined;
	}
}

/**
 * Construct a copy of an object such that all of its keys are lowercase.
 */
function _enforceLowercaseKeys(
	original: Record<string, any>,
): Record<string, any> {
	return Object.keys(original).reduce(
		(enforced: Record<string, any>, originalKey: string) => {
			enforced[originalKey.toLowerCase()] = original[originalKey];
			return enforced;
		},
		{},
	);
}
