import { HttpResponseStream } from '../../pkg/HttpResponseStream.ts';
import { describe, expect, it } from 'bun:test';

async function streamToString(
	stream: ReadableStream<Uint8Array>,
): Promise<string> {
	const reader = stream.getReader();
	let result = '';
	const decoder = new TextDecoder();
	while (true) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		result += decoder.decode(value, { stream: true });
	}
	return result;
}

async function streamToUint8Array(
	stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let totalLength = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		chunks.push(value);
		totalLength += value.length;
	}
	const result = new Uint8Array(totalLength);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.length;
	}
	return result;
}

describe('HttpResponseStream', () => {
	it('should prepend prelude and delimiter to an empty stream', async () => {
		const prelude = {
			statusCode: 200,
			headers: { 'Content-Type': 'text/plain' },
		};
		const underlyingStream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.close();
			},
		});

		const httpResponseStream = HttpResponseStream.from(
			underlyingStream,
			prelude,
		);
		const resultBytes = await streamToUint8Array(httpResponseStream);

		const expectedPrelude = JSON.stringify(prelude);
		const expectedPreludeBytes = new Uint8Array(
			new TextEncoder().encode(expectedPrelude),
		);
		const expectedDelimiterBytes = new Uint8Array(8); // 8 null bytes

		expect(resultBytes.length).toBe(
			expectedPreludeBytes.length + expectedDelimiterBytes.length,
		);
		expect(
			new Uint8Array(resultBytes.slice(0, expectedPreludeBytes.length)),
		).toEqual(expectedPreludeBytes);
		expect(
			new Uint8Array(resultBytes.slice(expectedPreludeBytes.length)),
		).toEqual(expectedDelimiterBytes);
	});

	it('should prepend prelude and delimiter and pass through data chunks', async () => {
		const prelude = { statusCode: 201 };
		const dataChunks = [
			new TextEncoder().encode('Hello, '),
			new TextEncoder().encode('world!'),
		];
		const underlyingStream = new ReadableStream<Uint8Array>({
			start(controller) {
				for (const chunk of dataChunks) {
					controller.enqueue(chunk);
				}
				controller.close();
			},
		});

		const httpResponseStream = HttpResponseStream.from(
			underlyingStream,
			prelude,
		);
		const resultBytes = await streamToUint8Array(httpResponseStream);

		const expectedPrelude = JSON.stringify(prelude);
		const expectedPreludeBytes = new Uint8Array(
			new TextEncoder().encode(expectedPrelude),
		);
		const expectedDelimiterBytes = new Uint8Array(8);
		const expectedDataBytes = new Uint8Array(
			dataChunks[0]!.length + dataChunks[1]!.length,
		);
		expectedDataBytes.set(dataChunks[0]!, 0);
		expectedDataBytes.set(dataChunks[1]!, dataChunks[0]!.length);

		const expectedTotalLength =
			expectedPreludeBytes.length +
			expectedDelimiterBytes.length +
			expectedDataBytes.length;
		expect(resultBytes.length).toBe(expectedTotalLength);
		expect(
			new Uint8Array(resultBytes.slice(0, expectedPreludeBytes.length)),
		).toEqual(expectedPreludeBytes);
		expect(
			new Uint8Array(
				resultBytes.slice(
					expectedPreludeBytes.length,
					expectedPreludeBytes.length + expectedDelimiterBytes.length,
				),
			),
		).toEqual(expectedDelimiterBytes);
		expect(
			new Uint8Array(
				resultBytes.slice(
					expectedPreludeBytes.length + expectedDelimiterBytes.length,
				),
			),
		).toEqual(expectedDataBytes);
	});

	it('should correctly handle an underlying stream that errors', async () => {
		const prelude = { statusCode: 500 };
		const testError = new Error('Underlying stream failed');
		const underlyingStream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.error(testError);
			},
		});

		const httpResponseStream = HttpResponseStream.from(
			underlyingStream,
			prelude,
		);

		try {
			await streamToString(httpResponseStream);
			// Should not reach here
			expect(true).toBe(false);
		} catch (e: any) {
			expect(e).toBe(testError);
		}
	});

	it('should handle empty prelude', async () => {
		const prelude = {};
		const data = new Uint8Array(new TextEncoder().encode('data'));
		const underlyingStream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(data);
				controller.close();
			},
		});

		const httpResponseStream = HttpResponseStream.from(
			underlyingStream,
			prelude,
		);
		const resultBytes = await streamToUint8Array(httpResponseStream);

		const expectedPrelude = JSON.stringify(prelude);
		const expectedPreludeBytes = new Uint8Array(
			new TextEncoder().encode(expectedPrelude),
		);
		const expectedDelimiterBytes = new Uint8Array(8);

		const expectedTotalLength =
			expectedPreludeBytes.length + expectedDelimiterBytes.length + data.length;
		expect(resultBytes.length).toBe(expectedTotalLength);
		expect(
			new Uint8Array(resultBytes.slice(0, expectedPreludeBytes.length)),
		).toEqual(expectedPreludeBytes);
		expect(
			new Uint8Array(
				resultBytes.slice(
					expectedPreludeBytes.length,
					expectedPreludeBytes.length + expectedDelimiterBytes.length,
				),
			),
		).toEqual(expectedDelimiterBytes);
		expect(
			new Uint8Array(
				resultBytes.slice(
					expectedPreludeBytes.length + expectedDelimiterBytes.length,
				),
			),
		).toEqual(data);
	});

	it('should handle prelude with various data types', async () => {
		const prelude = {
			statusCode: 200,
			headers: { 'X-Custom': 'value', 'X-Number': '123' },
			cookies: ['a=b', 'c=d'],
		};
		const underlyingStream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.close();
			},
		});

		const httpResponseStream = HttpResponseStream.from(
			underlyingStream,
			prelude,
		);
		const resultBytes = await streamToUint8Array(httpResponseStream);

		const expectedPrelude = JSON.stringify(prelude);
		const expectedPreludeBytes = new Uint8Array(
			new TextEncoder().encode(expectedPrelude),
		);
		const expectedDelimiterBytes = new Uint8Array(8);

		expect(resultBytes.length).toBe(
			expectedPreludeBytes.length + expectedDelimiterBytes.length,
		);
		expect(
			new Uint8Array(resultBytes.slice(0, expectedPreludeBytes.length)),
		).toEqual(expectedPreludeBytes);
		expect(
			new Uint8Array(resultBytes.slice(expectedPreludeBytes.length)),
		).toEqual(expectedDelimiterBytes);
	});
});
