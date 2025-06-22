/**
 * Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 */

import { promisify } from 'util';

import InvokeContext from '../../pkg/InvokeContext.ts'; // Default import
import { describe, expect, it } from 'bun:test';

const sleep = promisify(setTimeout);

describe('Getting remaining invoke time', () => {
	it('should reduce by at least elapsed time', async () => {
		const initialDeadline = Date.now() + 1000;
		const headers: Record<string, string> = {
			'lambda-runtime-aws-request-id': 'test-id',
			'lambda-runtime-invoked-function-arn':
				'arn:aws:lambda:us-east-1:123456789012:function:test-function',
			'lambda-runtime-deadline-ms': initialDeadline.toString(),
			'lambda-runtime-client-context': '', // Optional, provide empty string
			'lambda-runtime-cognito-identity': '', // Optional, provide empty string
		};
		const invokeCtx = new InvokeContext(headers);

		// To test getRemainingTimeInMillis, we need to call attachEnvironmentData
		// as _headerData is private. We'll pass a dummy callbackContext.
		const dummyCallbackContext = {};
		const userContext = invokeCtx.attachEnvironmentData(dummyCallbackContext);

		const timeout = 100;
		const before = userContext.getRemainingTimeInMillis();
		await sleep(timeout + 10); // Ensure enough time has passed
		const after = userContext.getRemainingTimeInMillis();

		expect(before - after).toBeGreaterThanOrEqual(
			timeout - 5 /* Timers are not precise, allow 5ms drift */,
		);
	});

	it('should be within range', () => {
		const initialDeadline = Date.now() + 1000;
		const headers: Record<string, string> = {
			'lambda-runtime-aws-request-id': 'test-id',
			'lambda-runtime-invoked-function-arn':
				'arn:aws:lambda:us-east-1:123456789012:function:test-function',
			'lambda-runtime-deadline-ms': initialDeadline.toString(),
			'lambda-runtime-client-context': '',
			'lambda-runtime-cognito-identity': '',
		};
		const invokeCtx = new InvokeContext(headers);
		const dummyCallbackContext = {};
		const userContext = invokeCtx.attachEnvironmentData(dummyCallbackContext);

		const remainingTime = userContext.getRemainingTimeInMillis();

		expect(remainingTime).toBeGreaterThan(0);
		expect(remainingTime).toBeLessThanOrEqual(1000); // Or initialDeadline - Date.now() for more precision
	});
});
