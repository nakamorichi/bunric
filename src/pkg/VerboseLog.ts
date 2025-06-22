/**
 * Copyright 2021 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 */

const EnvVarName = 'AWS_LAMBDA_RUNTIME_VERBOSE';
const Tag = 'RUNTIME';
const Verbosity: number = (() => {
	if (!process.env[EnvVarName]) {
		return 0;
	}

	try {
		const verbosity = Number.parseInt(process.env[EnvVarName] || '0', 10);
		return verbosity < 0 ? 0 : verbosity > 3 ? 3 : verbosity;
	} catch (_) {
		return 0;
	}
})();

interface Logger {
	verbose: (...args: any[]) => void;
	vverbose: (...args: any[]) => void;
	vvverbose: (...args: any[]) => void;
}

export function logger(category: string): Logger {
	return {
		verbose: (...args: any[]): void => {
			if (Verbosity >= 1) {
				const evaluatedArgs = args.map((arg) =>
					typeof arg === 'function' ? arg() : arg,
				);
				console.log(Tag, category, ...evaluatedArgs);
			}
		},
		vverbose: (...args: any[]): void => {
			if (Verbosity >= 2) {
				const evaluatedArgs = args.map((arg) =>
					typeof arg === 'function' ? arg() : arg,
				);
				console.log(Tag, category, ...evaluatedArgs);
			}
		},
		vvverbose: (...args: any[]): void => {
			if (Verbosity >= 3) {
				const evaluatedArgs = args.map((arg) =>
					typeof arg === 'function' ? arg() : arg,
				);
				console.log(Tag, category, ...evaluatedArgs);
			}
		},
	};
}

// For direct compatibility or convenience if some modules import these directly.
const defaultLogger = logger('DEFAULT');
export const verbose = defaultLogger.verbose;
export const vverbose = defaultLogger.vverbose;
export const vvverbose = defaultLogger.vvverbose;
