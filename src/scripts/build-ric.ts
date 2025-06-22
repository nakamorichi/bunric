#!/usr/bin/env bun

/**
 * Build script for AWS Lambda Node.js Runtime Interface Client with Bun
 *
 * This script creates an optimized build of the RIC package using Bun's
 * advanced bundling features like bytecode compilation and minification.
 */

import type { BuildOutput } from 'bun';

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const DIST_DIR = './dist';
const BIN_DIR = './bin';

console.log('🏗️ Building optimized AWS Lambda RIC for Bun runtime...');

// Clean up previous builds
try {
	await Bun.write(Bun.file('/dev/null'), ''); // Ensure Bun.write is available
	console.log('🧹 Cleaning up previous builds...');
	await Bun.$`rm -rf ${DIST_DIR}`;
	await mkdir(DIST_DIR, { recursive: true });
} catch (err) {
	console.error('❌ Failed to clean up previous builds:', err);
	process.exit(1);
}

// Build the main RIC package with optimizations
try {
	console.log('📦 Bundling main RIC package...');

	const buildResult: BuildOutput = await Bun.build({
		entrypoints: ['./src/index.ts'],
		outdir: DIST_DIR,
		target: 'bun',
		format: 'esm',
		naming: '[dir]/[name].mjs',
		minify: {
			whitespace: true,
			identifiers: true,
			syntax: true,
		},
		sourcemap: 'external', // Include sourcemaps for better debugging
		bytecode: true, // Generate bytecode for faster startup
	});

	if (!buildResult.success) {
		console.error('❌ Build failed:', buildResult.logs);
		process.exit(1);
	}

	console.log(`✅ Successfully built ${buildResult.outputs.length} files`);

	// Create the bin/index.mjs entry point
	console.log('📌 Creating bin entrypoint...');
	const binContent = `#!/usr/bin/env bun
import "../dist/index.mjs";
`;
	await mkdir(BIN_DIR, { recursive: true });
	await Bun.write(join(BIN_DIR, 'index.mjs'), binContent);
	await Bun.$`chmod +x ${join(BIN_DIR, 'index.mjs')}`;

	console.log('✅ Successfully created bin entrypoint');
} catch (err) {
	console.error('❌ Build failed with error:', err);
	process.exit(1);
}

console.log('🎉 Build completed successfully');
