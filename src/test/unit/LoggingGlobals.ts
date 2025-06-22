/**
 * Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 */

/**
 * Testing logging in unit tests requires manipulating the global console and
 * stdout objects.
 * This module provides methods for safely capturing and restoring these
 * objects under test.
 */

interface LogLevelInfo {
	name: string;
}
const levels: Record<string, LogLevelInfo> = Object.freeze({
	TRACE: { name: 'TRACE' },
	DEBUG: { name: 'DEBUG' },
	INFO: { name: 'INFO' },
	WARN: { name: 'WARN' },
	ERROR: { name: 'ERROR' },
	FATAL: { name: 'FATAL' },
});

interface LogFormatInfo {
	name: string;
}
const formats: Record<string, LogFormatInfo> = Object.freeze({
	TEXT: { name: 'TEXT' },
	JSON: { name: 'JSON' },
});

type ConsoleMethod = (...args: any[]) => void;

interface OriginalConsoleMethods {
	log: ConsoleMethod;
	debug: ConsoleMethod;
	info: ConsoleMethod;
	warn: ConsoleMethod;
	error: ConsoleMethod;
	trace: ConsoleMethod;
	fatal?: ConsoleMethod; // fatal might not be standard
}

export function consoleSnapshot(): () => void {
	const originalMethods: OriginalConsoleMethods = {
		log: console.log,
		debug: console.debug,
		info: console.info,
		warn: console.warn,
		error: console.error,
		trace: (console as any).trace, // Use 'as any' if trace is not on standard Console type
		fatal: (console as any).fatal, // Use 'as any' for fatal
	};

	return function restoreConsole(): void {
		console.log = originalMethods.log;
		console.debug = originalMethods.debug;
		console.info = originalMethods.info;
		console.warn = originalMethods.warn;
		console.error = originalMethods.error;
		(console as any).trace = originalMethods.trace;
		if (originalMethods.fatal) {
			(console as any).fatal = originalMethods.fatal;
		}
	};
}

interface CapturedStream {
	hook: () => void;
	unhook: () => void;
	captured: () => string;
	resetBuffer: () => void;
}

/**
 * Capture all of the writes to a given stream.
 */
export function captureStream(stream: NodeJS.WriteStream): CapturedStream {
	const originalWrite = stream.write;
	let buf = '';

	return {
		hook: (): void => {
			buf = ''; // reset the buffer
			// Using a more type-safe way to override stream.write
			(stream as any).write = (
				chunk: any,
				encodingOrCb?: any,
				cb?: any,
			): boolean => {
				buf += chunk.toString();
				// Call originalWrite correctly based on arguments
				if (typeof encodingOrCb === 'function') {
					return originalWrite.call(stream, chunk, encodingOrCb);
				} else if (typeof cb === 'function') {
					return originalWrite.call(stream, chunk, encodingOrCb, cb);
				} else {
					return originalWrite.call(stream, chunk);
				}
			};
		},
		unhook: (): void => {
			stream.write = originalWrite;
		},
		captured: (): string => buf,
		resetBuffer: (): void => {
			buf = '';
		},
	};
}

export class loggingConfig {
	turnOnStructuredLogging(): void {
		process.env['AWS_LAMBDA_LOG_FORMAT'] = formats.JSON!.name;
	}

	turnOffStructuredLogging(): void {
		delete process.env['AWS_LAMBDA_LOG_FORMAT'];
	}

	setLogLevel(level: string): void {
		const upperLevel = level?.toUpperCase();
		if (upperLevel && levels[upperLevel] !== undefined) {
			process.env['AWS_LAMBDA_LOG_LEVEL'] = levels[upperLevel].name;
		} else {
			// console.warn(`loggingConfig: Invalid log level provided: ${level}`);
		}
	}

	resetLogLevel(): void {
		delete process.env['AWS_LAMBDA_LOG_LEVEL'];
	}
}
