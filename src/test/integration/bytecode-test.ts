#!/usr/bin/env bun

/**
 * Integration test for bytecode compilation scenarios
 * This test attempts to replicate the actual Lambda/RIE bytecode execution environment
 */

import { execSync, spawn } from 'child_process';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';

const TEST_DIR = path.join(__dirname, 'bytecode-test-env');
const BUNRIC_BINARY = path.join(TEST_DIR, 'bunric');
const HANDLER_BINARY = path.join(TEST_DIR, 'handler.bun');

async function setupTestEnvironment() {
	console.log('🔧 Setting up bytecode test environment...');
	
	// Create test directory
	if (!existsSync(TEST_DIR)) {
		mkdirSync(TEST_DIR, { recursive: true });
	}

	// Create a test handler file
	const handlerSource = `
export const handler = async (event, context) => {
	console.log('Handler called with event:', JSON.stringify(event));
	return {
		statusCode: 200,
		body: JSON.stringify({
			message: 'Hello from bytecode handler!',
			event,
			timestamp: new Date().toISOString()
		})
	};
};
`;

	const handlerPath = path.join(TEST_DIR, 'handler.js');
	writeFileSync(handlerPath, handlerSource);

	// Create package.json for the handler
	const packageJson = {
		name: 'test-handler',
		version: '1.0.0',
		type: 'module'
	};
	writeFileSync(path.join(TEST_DIR, 'package.json'), JSON.stringify(packageJson, null, 2));

	console.log('✅ Test environment created');
}

async function compileToBytecode() {
	console.log('🔥 Compiling handler to bytecode...');
	
	try {
		// Compile the test handler to bytecode
		const handlerPath = path.join(TEST_DIR, 'handler.js');
		execSync(`bun build ${handlerPath} --target=bun --format=esm --bytecode --outfile=${HANDLER_BINARY}`, {
			cwd: TEST_DIR,
			stdio: 'inherit'
		});
		console.log('✅ Handler compiled to bytecode');

		// Copy bunric binary (assuming it's already built)
		const sourceBunric = path.join(__dirname, '../../../dist/index.js');
		if (existsSync(sourceBunric)) {
			execSync(`cp ${sourceBunric} ${BUNRIC_BINARY}`, { stdio: 'inherit' });
			execSync(`chmod +x ${BUNRIC_BINARY}`, { stdio: 'inherit' });
			console.log('✅ Bunric binary prepared');
		} else {
			console.log('❌ Bunric binary not found. Run "bun run dist" first.');
			return false;
		}

		return true;
	} catch (error) {
		console.error('❌ Compilation failed:', error);
		return false;
	}
}

async function testBytecodeExecution() {
	console.log('🧪 Testing bytecode execution...');
	
	return new Promise<boolean>((resolve) => {
		// Set environment variables to simulate Lambda environment
		const env = {
			...process.env,
			AWS_LAMBDA_RUNTIME_API: '127.0.0.1:9001',
			LAMBDA_TASK_ROOT: TEST_DIR,
			_HANDLER: 'handler.handler',
			_BUN_BYTECODE: '1' // Force bytecode detection
		};

		// Spawn bunric with the bytecode handler
		const child = spawn('bun', [BUNRIC_BINARY, 'handler.handler'], {
			cwd: TEST_DIR,
			env,
			stdio: 'pipe'
		});

		let stdout = '';
		let stderr = '';

		child.stdout.on('data', (data) => {
			stdout += data.toString();
			console.log('STDOUT:', data.toString());
		});

		child.stderr.on('data', (data) => {
			stderr += data.toString();
			console.log('STDERR:', data.toString());
		});

		child.on('close', (code) => {
			console.log(`\n🏁 Process exited with code: ${code}`);
			console.log(`📤 STDOUT:\n${stdout}`);
			console.log(`📥 STDERR:\n${stderr}`);
			
			// Check for the specific destructuring error
			const hasDestructuringError = stderr.includes('Right side of assignment cannot be destr');
			const hasOtherErrors = code !== 0 && !hasDestructuringError;
			
			if (hasDestructuringError) {
				console.log('🔴 DESTRUCTURING ERROR REPRODUCED!');
				resolve(false);
			} else if (hasOtherErrors) {
				console.log('🟡 Other error occurred (not the target issue)');
				resolve(false);
			} else {
				console.log('🟢 No destructuring error detected');
				resolve(true);
			}
		});

		// Kill the process after 5 seconds if it's still running
		setTimeout(() => {
			if (!child.killed) {
				console.log('⏰ Killing process after timeout');
				child.kill();
				resolve(false);
			}
		}, 5000);
	});
}

async function runBytecodeTest() {
	console.log('🚀 Starting Bytecode Integration Test\n');
	
	try {
		await setupTestEnvironment();
		
		const compiled = await compileToBytecode();
		if (!compiled) {
			console.log('❌ Test failed: Could not compile to bytecode');
			process.exit(1);
		}

		const success = await testBytecodeExecution();
		
		if (success) {
			console.log('\n✅ BYTECODE TEST PASSED - No destructuring errors detected');
		} else {
			console.log('\n❌ BYTECODE TEST FAILED - Issue reproduced or other errors occurred');
		}
		
		process.exit(success ? 0 : 1);
	} catch (error) {
		console.error('💥 Test failed with exception:', error);
		process.exit(1);
	}
}

// Run the test if this file is executed directly
if (import.meta.main) {
	runBytecodeTest();
}

export { runBytecodeTest };