/**
 * Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 */

interface XRayStackEntry {
	path: string;
	line: number;
	label: string;
}

interface XRayException {
	type: string | undefined;
	message: string | undefined;
	stack: XRayStackEntry[];
}

class XRayFormattedCause {
	working_directory: string;
	exceptions: XRayException[];
	paths: string[];

	constructor(err: Error) {
		this.working_directory = process.cwd(); // eslint-disable-line

		const stack: XRayStackEntry[] = [];
		if (err.stack) {
			const stackLines = err.stack.replace(/\x7F/g, '%7F').split('\n');
			stackLines.shift(); // Remove the error message line

			stackLines.forEach((stackLine) => {
				let line = stackLine.trim().replace(/\(|\)/g, '');
				line = line.substring(line.indexOf(' ') + 1); // Remove "at "

				const label =
					line.lastIndexOf(' ') >= 0
						? line.slice(0, line.lastIndexOf(' '))
						: null;
				const pathString =
					label === undefined || label === null || label.length === 0
						? line
						: line.slice(line.lastIndexOf(' ') + 1);

				const pathParts = pathString.split(':');
				const filePath = pathParts[0];
				let lineNumber: number | undefined;
				if (pathParts.length > 1 && pathParts[1]) {
					lineNumber = Number.parseInt(pathParts[1], 10);
				}

				if (filePath && lineNumber !== undefined && !Number.isNaN(lineNumber)) {
					const entry: XRayStackEntry = {
						path: filePath,
						line: lineNumber,
						label: label || 'anonymous',
					};
					stack.push(entry);
				}
			});
		}

		this.exceptions = [
			{
				type: err.name?.replace(/\x7F/g, '%7F'),
				message: err.message?.replace(/\x7F/g, '%7F'),
				stack: stack,
			},
		];

		const paths = new Set<string>();
		stack.forEach((entry) => {
			paths.add(entry.path);
		});
		this.paths = Array.from(paths);
	}
}

export default {
	formatted: (err: Error): string => {
		try {
			return JSON.stringify(new XRayFormattedCause(err));
		} catch (stringifyErr) {
			// If stringifying the formatted error fails, return an empty string or a minimal error representation.
			console.error('Failed to stringify XRayFormattedCause:', stringifyErr);
			return '';
		}
	},
};

/**
 * prepare an exception blob for sending to AWS X-Ray
 * adapted from https://code.amazon.com/packages/AWSTracingSDKNode/blobs/c917508ca4fce6a795f95dc30c91b70c6bc6c617/--/core/lib/segments/attributes/captured_exception.js
 * transform an Error, or Error-like, into an exception parseable by X-Ray's service.
 *  {
 *      "name": "CustomException",
 *      "message": "Something bad happend!",
 *      "stack": [
 *          "exports.handler (/var/task/node_modules/event_invoke.js:3:502)
 *      ]
 *  }
 * =>
 *  {
 *       "working_directory": "/var/task",
 *       "exceptions": [
 *           {
 *               "type": "CustomException",
 *               "message": "Something bad happend!",
 *               "stack": [
 *                   {
 *                       "path": "/var/task/event_invoke.js",
 *                       "line": 502,
 *                       "label": "exports.throw_custom_exception"
 *                   }
 *               ]
 *           }
 *       ],
 *       "paths": [
 *           "/var/task/event_invoke.js"
 *       ]
 *  }
 */
// The class XRayFormattedCause is now defined above and is not exported directly by default.
// It's used internally by the exported 'formatted' function.
