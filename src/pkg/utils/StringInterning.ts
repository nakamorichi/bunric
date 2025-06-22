/**
 * String Interning implementation for reducing memory usage
 * Part of Phase 2: Core Performance Enhancements
 */

/**
 * String interning cache for frequently used strings
 */
export class StringInternCache {
	private cache = new Map<string, string>();
	private maxSize: number;
	private hitCount = 0;
	private missCount = 0;

	constructor(maxSize = 1000) {
		this.maxSize = maxSize;
	}

	/**
	 * Intern a string - return cached version if exists, otherwise cache and return
	 */
	intern(str: string): string {
		if (this.cache.has(str)) {
			this.hitCount++;
			return this.cache.get(str)!;
		}

		this.missCount++;

		// If cache is full, remove oldest entries (simple LRU approximation)
		if (this.cache.size >= this.maxSize) {
			const firstKey = this.cache.keys().next().value;
			if (firstKey !== undefined) {
				this.cache.delete(firstKey);
			}
		}

		this.cache.set(str, str);
		return str;
	}

	/**
	 * Get cache statistics
	 */
	getStats() {
		return {
			size: this.cache.size,
			maxSize: this.maxSize,
			hitCount: this.hitCount,
			missCount: this.missCount,
			hitRate:
				this.hitCount + this.missCount > 0
					? this.hitCount / (this.hitCount + this.missCount)
					: 0,
		};
	}

	/**
	 * Clear the cache
	 */
	clear(): void {
		this.cache.clear();
		this.hitCount = 0;
		this.missCount = 0;
	}
}

/**
 * Global string intern cache for common Lambda runtime strings
 */
export const globalStringCache = new StringInternCache(500);

/**
 * Predefined interned strings for common Lambda runtime values
 */
export class InternedStrings {
	// HTTP Headers
	static readonly LAMBDA_RUNTIME_CLIENT_CONTEXT = globalStringCache.intern(
		'lambda-runtime-client-context',
	);
	static readonly LAMBDA_RUNTIME_COGNITO_IDENTITY = globalStringCache.intern(
		'lambda-runtime-cognito-identity',
	);
	static readonly LAMBDA_RUNTIME_INVOKED_FUNCTION_ARN =
		globalStringCache.intern('lambda-runtime-invoked-function-arn');
	static readonly LAMBDA_RUNTIME_AWS_REQUEST_ID = globalStringCache.intern(
		'lambda-runtime-aws-request-id',
	);
	static readonly LAMBDA_RUNTIME_DEADLINE_MS = globalStringCache.intern(
		'lambda-runtime-deadline-ms',
	);
	static readonly LAMBDA_RUNTIME_TRACE_ID = globalStringCache.intern(
		'lambda-runtime-trace-id',
	);
	static readonly LAMBDA_RUNTIME_AWS_TENANT_ID = globalStringCache.intern(
		'lambda-runtime-aws-tenant-id',
	);
	static readonly LAMBDA_RUNTIME_FUNCTION_ERROR_TYPE = globalStringCache.intern(
		'lambda-runtime-function-error-type',
	);
	static readonly LAMBDA_RUNTIME_FUNCTION_RESPONSE_MODE =
		globalStringCache.intern('lambda-runtime-function-response-mode');
	static readonly TRANSFER_ENCODING =
		globalStringCache.intern('transfer-encoding');
	static readonly CONTENT_TYPE = globalStringCache.intern('content-type');
	static readonly USER_AGENT = globalStringCache.intern('user-agent');

	// HTTP Values
	static readonly CHUNKED = globalStringCache.intern('chunked');
	static readonly STREAMING = globalStringCache.intern('streaming');
	static readonly APPLICATION_JSON =
		globalStringCache.intern('application/json');
	static readonly APPLICATION_VND_AWSLAMBDA_HTTP_INTEGRATION_RESPONSE =
		globalStringCache.intern(
			'application/vnd.awslambda.http-integration-response',
		);

	// Error Types
	static readonly RUNTIME_IMPORT_MODULE_ERROR = globalStringCache.intern(
		'Runtime.ImportModuleError',
	);
	static readonly RUNTIME_HANDLER_NOT_FOUND = globalStringCache.intern(
		'Runtime.HandlerNotFound',
	);
	static readonly RUNTIME_MALFORMED_HANDLER_NAME = globalStringCache.intern(
		'Runtime.MalformedHandlerName',
	);
	static readonly RUNTIME_USER_CODE_SYNTAX_ERROR = globalStringCache.intern(
		'Runtime.UserCodeSyntaxError',
	);
	static readonly RUNTIME_UNHANDLED_PROMISE_REJECTION =
		globalStringCache.intern('Runtime.UnhandledPromiseRejection');

	// Environment Variables
	static readonly AWS_LAMBDA_FUNCTION_VERSION = globalStringCache.intern(
		'AWS_LAMBDA_FUNCTION_VERSION',
	);
	static readonly AWS_LAMBDA_FUNCTION_NAME = globalStringCache.intern(
		'AWS_LAMBDA_FUNCTION_NAME',
	);
	static readonly AWS_LAMBDA_FUNCTION_MEMORY_SIZE = globalStringCache.intern(
		'AWS_LAMBDA_FUNCTION_MEMORY_SIZE',
	);
	static readonly AWS_LAMBDA_LOG_GROUP_NAME = globalStringCache.intern(
		'AWS_LAMBDA_LOG_GROUP_NAME',
	);
	static readonly AWS_LAMBDA_LOG_STREAM_NAME = globalStringCache.intern(
		'AWS_LAMBDA_LOG_STREAM_NAME',
	);
	static readonly AWS_LAMBDA_RUNTIME_API = globalStringCache.intern(
		'AWS_LAMBDA_RUNTIME_API',
	);
	static readonly _X_AMZN_TRACE_ID =
		globalStringCache.intern('_X_AMZN_TRACE_ID');

	// Common Log Messages
	static readonly RUNTIME_DEFAULT = globalStringCache.intern('RUNTIME DEFAULT');
	static readonly RUNTIME_STREAM = globalStringCache.intern('RUNTIME STREAM');
	static readonly RUNTIME_STREAMING_CONTEXT = globalStringCache.intern(
		'RUNTIME STREAMING_CONTEXT',
	);

	// File Extensions
	static readonly JS_EXTENSION = globalStringCache.intern('.js');
	static readonly MJS_EXTENSION = globalStringCache.intern('.mjs');
	static readonly CJS_EXTENSION = globalStringCache.intern('.cjs');
	static readonly TS_EXTENSION = globalStringCache.intern('.ts');

	// Common Paths
	static readonly NODE_MODULES = globalStringCache.intern('node_modules');
	static readonly PACKAGE_JSON = globalStringCache.intern('package.json');
	static readonly INDEX = globalStringCache.intern('index');
	static readonly DEFAULT = globalStringCache.intern('default');

	// HTTP Methods and Status
	static readonly GET = globalStringCache.intern('GET');
	static readonly POST = globalStringCache.intern('POST');
	static readonly HTTP_200 = globalStringCache.intern('200');
	static readonly HTTP_202 = globalStringCache.intern('202');
	static readonly HTTP_400 = globalStringCache.intern('400');
	static readonly HTTP_500 = globalStringCache.intern('500');
}

/**
 * Utility function to intern a string using the global cache
 */
export function intern(str: string): string {
	return globalStringCache.intern(str);
}

/**
 * Utility function to intern header names (converts to lowercase first)
 */
export function internHeaderName(headerName: string): string {
	return globalStringCache.intern(headerName.toLowerCase());
}

/**
 * Utility function to intern error messages with common prefixes
 */
export function internErrorMessage(message: string): string {
	// Common error message prefixes that should be interned
	const commonPrefixes = [
		'Cannot find module',
		'Module not found',
		'Handler not found',
		'Bad handler',
		'Failed to parse',
		'Syntax error',
		'Reference error',
		'Type error',
	];

	for (const prefix of commonPrefixes) {
		if (message.startsWith(prefix)) {
			// Intern the prefix and reconstruct the message
			const internedPrefix = globalStringCache.intern(prefix);
			const suffix = message.slice(prefix.length);
			return internedPrefix + suffix;
		}
	}

	// If no common prefix found, intern the whole message if it's short enough
	if (message.length <= 100) {
		return globalStringCache.intern(message);
	}

	return message;
}
