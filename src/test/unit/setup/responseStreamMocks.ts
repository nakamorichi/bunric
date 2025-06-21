import { mock } from 'bun:test';

// This is the global mock instance that tests can import or use.
export const mockVerboseLogVerbose = mock(() => {});

mock.module('../../src/VerboseLog.ts', () => ({
	logger: () => ({
		verbose: mockVerboseLogVerbose,
		vverbose: mock(() => {}), // Provide mocks for other log levels too
		vvverbose: mock(() => {}),
	}),
	// Exporting verbose, vverbose, vvverbose directly in case some modules
	// try to import them individually via `import { verbose } from '../../src/VerboseLog.ts'`
	verbose: mockVerboseLogVerbose,
	vverbose: mock(() => {}),
	vvverbose: mock(() => {}),
}));
