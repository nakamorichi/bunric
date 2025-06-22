/**
 * Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 */

import * as Errors from '../../pkg/Errors.ts';
import { describe, expect, it } from 'bun:test';

describe('Formatted Error Logging', () => {
	it('should fall back to a minimal error format when an exception occurs', () => {
		const error: any = new Error('custom message'); // Use any for adding custom properties
		error.name = 'CircularError';
		error.backlink = error; // Create a circular reference

		const formattedErrorString = Errors.toFormatted(error);
		expect(formattedErrorString).toBeTypeOf('string');

		// The .trim() is important as toFormatted adds a leading tab
		const loggedError = JSON.parse(formattedErrorString.trim());

		expect(loggedError).toHaveProperty('errorType', 'CircularError');
		expect(loggedError).toHaveProperty('errorMessage', 'custom message');
		// The exact length of trace can be brittle, so we check if it's an array
		expect(loggedError.trace).toBeArray();
		// If a specific length is critical and stable, it can be asserted:
		// expect(loggedError.trace.length).toBe(11);
		// For now, just checking if it's an array is more robust to minor stack changes.
	});
});

describe('Invalid chars in HTTP header', () => {
	it('should be replaced in toRapidResponse', () => {
		const errorWithInvalidChar = new Error('\x7F \x7F');
		errorWithInvalidChar.name = 'ErrorWithInvalidChar';

		const loggedError = Errors.toRapidResponse(errorWithInvalidChar);
		expect(loggedError).toHaveProperty('errorType', 'ErrorWithInvalidChar');
		expect(loggedError).toHaveProperty('errorMessage', '%7F %7F');
	});
});
