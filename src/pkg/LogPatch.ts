/**
 * Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 */

import fs from 'node:fs';
import util from 'node:util';

import * as Errors from './Errors.ts';

interface StructuredConsole {
	logError?: (messageOrError: string | Error, error?: Error) => void;
}
export const structuredConsole: StructuredConsole = {};

interface LogLevel {
	name: string;
	priority: number;
	tlvMask: number;
}

const jsonErrorReplacer = (_key: string, value: any): any => {
	if (value instanceof Error) {
		const serializedErr: any = {
			errorType: value?.constructor?.name ?? 'UnknownError',
			errorMessage: value.message,
			stackTrace: value.stack?.split('\n'), // Safer stack trace handling
			...value, // Spread any additional enumerable properties
		};
		return serializedErr;
	}
	return value;
};

function formatJsonMessage(
	requestId: string | undefined,
	timestamp: string,
	level: LogLevel,
	tenantId: string | undefined,
	...messageParams: any[]
): string {
	const result: any = {
		timestamp: timestamp,
		level: level.name,
		requestId: requestId,
	};

	if (tenantId !== undefined && tenantId !== null) {
		result.tenantId = tenantId;
	}

	if (messageParams.length === 1) {
		result.message = messageParams[0];
		try {
			return JSON.stringify(result, jsonErrorReplacer);
		} catch (_) {
			result.message = util.format(result.message);
			return JSON.stringify(result);
		}
	}

	result.message = util.format(...messageParams);
	for (const param of messageParams) {
		if (param instanceof Error) {
			result.errorType = param?.constructor?.name ?? 'UnknownError';
			result.errorMessage = param.message;
			result.stackTrace = param.stack?.split('\n'); // Safer stack trace handling
			break;
		}
	}
	return JSON.stringify(result);
}

/* Use a unique symbol to provide global access without risk of name clashes. */
const REQUEST_ID_SYMBOL: unique symbol = Symbol.for(
	'aws.lambda.runtime.requestId',
);
const TENANT_ID_SYMBOL: unique symbol = Symbol.for(
	'aws.lambda.runtime.tenantId',
);

// Augment the globalThis interface to declare the type of the property accessed by the symbol.
declare global {
	interface globalThis {
		[REQUEST_ID_SYMBOL]?: string; // Property is optional and can be string or undefined
		[TENANT_ID_SYMBOL]?: string; // Property is optional and can be string or undefined
	}
}

function getCurrentRequestId(): string | undefined {
	return (globalThis as any)[REQUEST_ID_SYMBOL];
}

function getCurrentTenantId(): string | undefined {
	return (globalThis as any)[TENANT_ID_SYMBOL];
}

function setCurrentRequestIdInternal(id: string | undefined): void {
	(globalThis as any)[REQUEST_ID_SYMBOL] = id;
}

function setCurrentTenantIdInternal(id: string | undefined): void {
	(globalThis as any)[TENANT_ID_SYMBOL] = id;
}

export function setCurrentRequestId(id: string | undefined): void {
	setCurrentRequestIdInternal(id);
}

export function setCurrentTenantId(id: string | undefined): void {
	setCurrentTenantIdInternal(id);
}

const logTextToStdout = (
	level: LogLevel,
	message: any,
	...params: any[]
): void => {
	const time = new Date().toISOString();
	const requestId = getCurrentRequestId();
	let line = `${time}\t${requestId || ''}\t${level.name}\t${util.format(
		message,
		...params,
	)}`;
	line = line.replace(/\n/g, '\r');
	process.stdout.write(`${line}\n`);
};

const logJsonToStdout = (
	level: LogLevel,
	message: any,
	...params: any[]
): void => {
	const time = new Date().toISOString();
	const requestId = getCurrentRequestId();
	const tenantId = getCurrentTenantId();
	let line = formatJsonMessage(
		requestId,
		time,
		level,
		tenantId,
		message,
		...params,
	);
	line = line.replace(/\n/g, '\r');
	process.stdout.write(`${line}\n`);
};

const logTextToFd = (logTarget: number) => {
	const typeAndLength = Buffer.alloc(16);
	return (level: LogLevel, message: any, ...params: any[]): void => {
		const date = new Date();
		const time = date.toISOString();
		const requestId = getCurrentRequestId();
		const enrichedMessage = `${time}\t${requestId || ''}\t${level.name}\t${util.format(
			message,
			...params,
		)}\n`;

		typeAndLength.writeUInt32BE((0xa55a0003 | level.tlvMask) >>> 0, 0);
		const messageBytes = Buffer.from(enrichedMessage, 'utf8');
		typeAndLength.writeInt32BE(messageBytes.length, 4);
		typeAndLength.writeBigInt64BE(BigInt(date.valueOf()) * 1000n, 8);
		fs.writeSync(logTarget, typeAndLength);
		fs.writeSync(logTarget, messageBytes);
	};
};

const logJsonToFd = (logTarget: number) => {
	const typeAndLength = Buffer.alloc(16);
	return (level: LogLevel, message: any, ...params: any[]): void => {
		const date = new Date();
		const time = date.toISOString();
		const requestId = getCurrentRequestId();
		const tenantId = getCurrentTenantId();
		const enrichedMessage = formatJsonMessage(
			requestId,
			time,
			level,
			tenantId,
			message,
			...params,
		);

		typeAndLength.writeUInt32BE((0xa55a0002 | level.tlvMask) >>> 0, 0);
		const messageBytes = Buffer.from(enrichedMessage, 'utf8');
		typeAndLength.writeInt32BE(messageBytes.length, 4);
		typeAndLength.writeBigInt64BE(BigInt(date.valueOf()) * 1000n, 8);
		fs.writeSync(logTarget, typeAndLength);
		fs.writeSync(logTarget, messageBytes);
	};
};

function _patchConsoleWith(
	log: (level: LogLevel, message: any, ...params: any[]) => void,
): void {
	const NopLog = (_message?: any, ..._params: any[]): void => {};
	const levels: Record<string, LogLevel> = Object.freeze({
		TRACE: { name: 'TRACE', priority: 1, tlvMask: 0b00100 },
		DEBUG: { name: 'DEBUG', priority: 2, tlvMask: 0b01000 },
		INFO: { name: 'INFO', priority: 3, tlvMask: 0b01100 },
		WARN: { name: 'WARN', priority: 4, tlvMask: 0b10000 },
		ERROR: { name: 'ERROR', priority: 5, tlvMask: 0b10100 },
		FATAL: { name: 'FATAL', priority: 6, tlvMask: 0b11000 },
	});
	const awsLambdaLogLevelEnv = process.env.AWS_LAMBDA_LOG_LEVEL?.toUpperCase();
	const awsLambdaLogLevel: LogLevel =
		awsLambdaLogLevelEnv && levels[awsLambdaLogLevelEnv]
			? levels[awsLambdaLogLevelEnv]! // Assert that if the key exists, the value is LogLevel
			: levels.TRACE!; // Assert that levels.TRACE is LogLevel

	// With awsLambdaLogLevel now firmly LogLevel, and levels.TRACE etc. asserted, these should be fine.
	console.trace =
		levels.TRACE!.priority >= awsLambdaLogLevel.priority
			? (msg?: any, ...params: any[]) => log(levels.TRACE!, msg, ...params)
			: NopLog;
	console.debug =
		levels.DEBUG!.priority >= awsLambdaLogLevel.priority
			? (msg?: any, ...params: any[]) => log(levels.DEBUG!, msg, ...params)
			: NopLog;
	console.info =
		levels.INFO!.priority >= awsLambdaLogLevel.priority
			? (msg?: any, ...params: any[]) => log(levels.INFO!, msg, ...params)
			: NopLog;
	console.log = console.info; // Alias log to info
	console.warn =
		levels.WARN!.priority >= awsLambdaLogLevel.priority
			? (msg?: any, ...params: any[]) => log(levels.WARN!, msg, ...params)
			: NopLog;
	console.error =
		levels.ERROR!.priority >= awsLambdaLogLevel.priority
			? (msg?: any, ...params: any[]) => log(levels.ERROR!, msg, ...params)
			: NopLog;
	(console as any).fatal = (msg?: any, ...params: any[]) => {
		// Add fatal to console type if necessary
		log(levels.FATAL!, msg, ...params);
	};
}

export function patchConsole(): void {
	const JsonName = 'JSON';
	const TextName = 'TEXT';
	const awsLambdaLogFormat =
		process.env.AWS_LAMBDA_LOG_FORMAT?.toUpperCase() === JsonName
			? JsonName
			: TextName;

	const jsonErrorLogger = (
		messageOrError: string | Error,
		error?: Error,
	): void => {
		if (typeof messageOrError === 'string' && error) {
			console.error(Errors.intoError(error));
		} else if (messageOrError instanceof Error) {
			console.error(Errors.intoError(messageOrError));
		} else if (error) {
			// Fallback if messageOrError is string but error is the main thing
			console.error(Errors.intoError(error));
		} else {
			// Fallback for unexpected single string as error
			console.error(Errors.intoError(new Error(String(messageOrError))));
		}
	};
	const textErrorLogger = (
		messageOrError: string | Error,
		error?: Error,
	): void => {
		if (typeof messageOrError === 'string' && error) {
			console.error(
				messageOrError,
				Errors.toFormatted(Errors.intoError(error)),
			);
		} else if (messageOrError instanceof Error) {
			// When called as logError(actualError), messageOrError is the error.
			// We need a generic message or use the error's message for the first part of console.error
			console.error(
				messageOrError.message,
				Errors.toFormatted(Errors.intoError(messageOrError)),
			);
		} else if (typeof messageOrError === 'string') {
			// Single string argument
			console.error(
				messageOrError,
				Errors.toFormatted(Errors.intoError(new Error(messageOrError))),
			);
		} else if (error) {
			// Fallback if messageOrError is not string/Error but error exists
			console.error('Error:', Errors.toFormatted(Errors.intoError(error)));
		}
	};

	let loggerImpl: (level: LogLevel, message: any, ...params: any[]) => void;
	const telemetryLogFdEnv = process.env._LAMBDA_TELEMETRY_LOG_FD;

	if (telemetryLogFdEnv != null) {
		// Check for null or undefined
		const logFd = Number.parseInt(telemetryLogFdEnv, 10);
		// It's good practice to ensure logFd is a valid number before using it.
		if (!Number.isNaN(logFd)) {
			delete process.env._LAMBDA_TELEMETRY_LOG_FD;
			loggerImpl =
				awsLambdaLogFormat === JsonName
					? logJsonToFd(logFd)
					: logTextToFd(logFd);
		} else {
			// Fallback if _LAMBDA_TELEMETRY_LOG_FD is not a valid number
			console.warn(
				`Invalid _LAMBDA_TELEMETRY_LOG_FD: ${telemetryLogFdEnv}. Falling back to stdout logging.`,
			);
			loggerImpl =
				awsLambdaLogFormat === JsonName ? logJsonToStdout : logTextToStdout;
		}
	} else {
		loggerImpl =
			awsLambdaLogFormat === JsonName ? logJsonToStdout : logTextToStdout;
	}
	_patchConsoleWith(loggerImpl);
	structuredConsole.logError =
		awsLambdaLogFormat === JsonName ? jsonErrorLogger : textErrorLogger;
}
