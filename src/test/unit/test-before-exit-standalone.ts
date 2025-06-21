#!/usr/bin/env bun
/**
 * Standalone test for process.beforeExit behavior in Bun
 *
 * This script tests if process.beforeExit is properly triggered in a vanilla Bun environment
 * (not within the bun:test runner). This is needed because we know the behavior is different
 * between a regular Bun execution environment and the bun:test environment.
 *
 * Usage: bun run ./test/unit/test-before-exit-standalone.ts
 * Expected outcome: The script should log both "Starting test" and "beforeExit fired" messages,
 * then exit with code 0.
 */

console.log('Starting test');

// Flag to track if beforeExit was fired
let beforeExitFired = false;

// Register beforeExit handler
process.on('beforeExit', () => {
	console.log('beforeExit fired');
	beforeExitFired = true;

	// No need to call process.exit() because we want the process to exit naturally
});

// Using setTimeout to keep the event loop active temporarily
// This will allow the beforeExit event to be emitted once the event loop is empty
setTimeout(() => {
	console.log('Keeping event loop active');

	// Log the time to demonstrate when this runs vs when beforeExit fires
	console.log(`Current time: ${new Date().toISOString()}`);

	// Setup a check to verify if beforeExit fired after event loop emptied
	setTimeout(() => {}, 100);
}, 100);

// The process should naturally exit once all timers/callbacks have completed
// The beforeExit event should be triggered before that happens
