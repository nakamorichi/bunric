/**
 * Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 */

import assert from 'assert'; // Using Node's assert for now, can be replaced with expect if preferred
import fs from 'fs';
import os from 'os';
import path from 'path';

interface LevelInfo {
	name: string;
	tlvMask: number;
}

const levels: Record<string, LevelInfo> = Object.freeze({
	TRACE: { name: 'TRACE', tlvMask: 0b00100 },
	DEBUG: { name: 'DEBUG', tlvMask: 0b01000 },
	INFO: { name: 'INFO', tlvMask: 0b01100 },
	WARN: { name: 'WARN', tlvMask: 0b10000 },
	ERROR: { name: 'ERROR', tlvMask: 0b10100 },
	FATAL: { name: 'FATAL', tlvMask: 0b11000 },
});

const TextName = 'TEXT';

/**
 * A fake implementation of the multilne logging protocol.
 * Read and write log frames to a temp file and provide an asserting helper for
 * reading individual log statements from the file.
 */
export default class FakeTelemetryTarget {
	private readTarget: number;
	private writeTarget: number;
	private tempDir: string | null = null;

	constructor() {
		this.readTarget = 0;
		this.writeTarget = 0;
	}

	openFile(): void {
		this.tempDir = fs.mkdtempSync(
			path.join(os.tmpdir(), 'AWSLambdaNodeJsTelemetry-'),
		);
		const logFilePath = path.join(this.tempDir, 'log');
		this.writeTarget = fs.openSync(logFilePath, 'as+'); // 'as+' might not be ideal, 'w+' or 'a+'?
		this.readTarget = fs.openSync(logFilePath, 'rs+');
		// console.log( // This console log might interfere with tests capturing stdout
		//   'Generated new telemetry file in',
		//   this.tempDir,
		//   'with write FD:', this.writeTarget, 'read FD:', this.readTarget
		// );
	}

	closeFile(): void {
		// console.log(`Closing telemetry filedescriptor read: ${this.readTarget}, write: ${this.writeTarget}`);
		if (this.readTarget !== 0) {
			fs.closeSync(this.readTarget);
			this.readTarget = 0;
		}
		if (this.writeTarget !== 0) {
			fs.closeSync(this.writeTarget);
			this.writeTarget = 0;
		}
		if (this.tempDir) {
			try {
				fs.rmSync(this.tempDir, { recursive: true, force: true });
			} catch (e) {
				console.error('Failed to remove temp telemetry dir', this.tempDir, e);
			}
			this.tempDir = null;
		}
	}

	updateEnv(): void {
		// process.env type expects string | undefined
		process.env['_LAMBDA_TELEMETRY_LOG_FD'] = String(this.writeTarget);
	}

	/**
	 * Read a single line from the telemetry file.
	 * Explodes when:
	 * - no line is present (unless expectEmpty is true)
	 * - the prefix is malformed
	 * - there aren't enough bytes
	 */
	readLine(
		level: string = 'INFO',
		format: string = TextName,
		expectEmpty: boolean = false,
	): string {
		const readLength = (): number => {
			const logPrefix = Buffer.alloc(16);
			if (this.readTarget === 0 && !expectEmpty) {
				throw new Error(
					'FakeTelemetryTarget: readTarget is not open for reading.',
				);
			}

			let actualReadBytes = 0;
			if (this.readTarget !== 0) {
				// Only read if fd is valid
				actualReadBytes = fs.readSync(
					this.readTarget,
					logPrefix,
					0,
					logPrefix.length,
					null, // Read from current position
				);
			}

			if (expectEmpty) {
				assert.strictEqual(
					actualReadBytes,
					0,
					`Expected actualReadBytes to be 0 when expectEmpty is true, but got [${actualReadBytes}]`,
				);
				return 0;
			}

			assert.strictEqual(
				actualReadBytes,
				logPrefix.length,
				`Expected actualReadBytes[${actualReadBytes}] to be ${logPrefix.length}`,
			);

			const targetLevelInfo = levels[level.toUpperCase()];
			if (!targetLevelInfo) {
				throw new Error(`Invalid level: ${level} provided to readLine`);
			}

			let tlvHeaderValue: number;
			if (format === TextName) {
				tlvHeaderValue = (0xa55a0003 | targetLevelInfo.tlvMask) >>> 0;
			} else {
				tlvHeaderValue = (0xa55a0002 | targetLevelInfo.tlvMask) >>> 0;
			}

			const expectedLogIdentifier = Buffer.alloc(4);
			expectedLogIdentifier.writeUInt32BE(tlvHeaderValue, 0);

			// Check first 4 bytes for the log identifier
			const actualLogIdentifier = logPrefix.subarray(0, 4);
			assert.deepStrictEqual(
				actualLogIdentifier,
				expectedLogIdentifier,
				`Log prefix ${logPrefix.toString('hex')} should start with ${expectedLogIdentifier.toString('hex')}`,
			);

			const len = logPrefix.readUInt32BE(4);
			// discard the timestamp
			logPrefix.readBigUInt64BE(8);
			return len;
		};

		const lineLength = readLength();
		if (lineLength === 0 && expectEmpty) {
			// If expectEmpty and readLength returned 0, it's fine.
			return '';
		}
		if (lineLength === 0 && !expectEmpty) {
			// If not expectEmpty but length is 0, something is wrong or file ended.
			// This case might indicate end of file or an issue.
			// The original code would proceed and likely fail on fs.readSync if readTarget is 0.
			// If readTarget is valid but lineLength is 0 after header, it's an empty log message.
			return '';
		}

		const lineBytes = Buffer.alloc(lineLength);
		if (this.readTarget === 0) {
			throw new Error(
				'FakeTelemetryTarget: readTarget is not open for reading lineBytes.',
			);
		}
		const actualLineSize = fs.readSync(
			this.readTarget,
			lineBytes,
			0,
			lineBytes.length,
			null, // Read from current position
		);
		assert.strictEqual(
			actualLineSize,
			lineBytes.length,
			'The log line must match the length specified in the frame header',
		);
		return lineBytes.toString('utf8');
	}
}
