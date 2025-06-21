/**
 * Simple structured logger for AWS Lambda Bun RIC
 * Outputs JSON-formatted logs for better observability
 */

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

interface LogEntry {
	level: LogLevel;
	timestamp: string;
	message: string;
	[key: string]: any;
}

/**
 * Create a structured log entry
 */
function createLogEntry(
	level: LogLevel,
	message: string,
	meta: Record<string, any> = {},
): LogEntry {
	return {
		level,
		timestamp: new Date().toISOString(),
		message,
		...meta,
	};
}

/**
 * Simple structured logger
 */
export const log = {
	debug: (message: string, meta: Record<string, any> = {}) => {
		if (process.env.DEBUG || process.env.AWS_LAMBDA_LOG_LEVEL === 'DEBUG') {
			console.debug(JSON.stringify(createLogEntry('DEBUG', message, meta)));
		}
	},

	info: (message: string, meta: Record<string, any> = {}) => {
		console.log(JSON.stringify(createLogEntry('INFO', message, meta)));
	},

	warn: (message: string, meta: Record<string, any> = {}) => {
		console.warn(JSON.stringify(createLogEntry('WARN', message, meta)));
	},

	error: (message: string, meta: Record<string, any> = {}) => {
		console.error(JSON.stringify(createLogEntry('ERROR', message, meta)));
	},
};
