/**
 * Test for tenant ID functionality
 */

import { describe, test, expect } from 'bun:test';
import InvokeContext from '../../pkg/InvokeContext.ts';
import { setCurrentTenantId } from '../../pkg/LogPatch.ts';

describe('Tenant ID functionality', () => {
	test('InvokeContext should extract tenant ID from headers', () => {
		const headers = {
			'lambda-runtime-aws-request-id': 'test-request-id',
			'lambda-runtime-aws-tenant-id': 'test-tenant-id',
			'lambda-runtime-deadline-ms': String(Date.now() + 30000),
		};

		const context = new InvokeContext(headers);
		expect(context.tenantId).toBe('test-tenant-id');
	});

	test('InvokeContext should handle missing tenant ID', () => {
		const headers = {
			'lambda-runtime-aws-request-id': 'test-request-id',
			'lambda-runtime-deadline-ms': String(Date.now() + 30000),
		};

		const context = new InvokeContext(headers);
		expect(context.tenantId).toBeUndefined();
	});

	test('InvokeContext should include tenant ID in context data', () => {
		const headers = {
			'lambda-runtime-aws-request-id': 'test-request-id',
			'lambda-runtime-aws-tenant-id': 'test-tenant-id',
			'lambda-runtime-deadline-ms': String(Date.now() + 30000),
		};

		const context = new InvokeContext(headers);
		const callbackContext = {};
		const result = context.attachEnvironmentData(callbackContext);

		expect(result.tenantId).toBe('test-tenant-id');
	});

	test('setCurrentTenantId should work', () => {
		// This is a basic test to ensure the function exists and can be called
		expect(() => setCurrentTenantId('test-tenant')).not.toThrow();
		expect(() => setCurrentTenantId(undefined)).not.toThrow();
	});
});
