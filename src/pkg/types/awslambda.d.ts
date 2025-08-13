export function createHttpResponseStream(
	underlyingStream: any,
	prelude: any,
): any;

// Legacy class interface for backward compatibility
// TODO: confirm whether could/should be removed
export class HttpResponseStream {
	static from(underlyingStream: any, prelude: any): any;
}

declare global {
	namespace awslambda {
		function streamifyResponse(handler: any, options: any): any;
		let HttpResponseStream: HttpResponseStream;
	}
}
