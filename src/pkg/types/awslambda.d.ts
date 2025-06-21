export function createHttpResponseStream(
	underlyingStream: any,
	prelude: any,
): any;

// Legacy class interface for backward compatibility
// biome-ignore lint/complexity/noStaticOnlyClass: Legacy compatibility interface
export class HttpResponseStream {
	static from(underlyingStream: any, prelude: any): any;
}

declare global {
	namespace awslambda {
		function streamifyResponse(handler: any, options: any): any;
		let HttpResponseStream: HttpResponseStream;
	}
}
