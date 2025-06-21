// Build configuration optimized for Bun runtime with bytecode support
// Single build that works both as module and executable

import dts from 'bun-plugin-dts'

// Build a single combined file that works as both module and executable
const build = await Bun.build({
	entrypoints: ['src/pkg/index.ts'], // Use pkg as main entry since it has the run function
	outdir: 'dist',
	target: 'bun',
	format: 'cjs', // Required for bytecode with bun target
	splitting: false,
	packages: 'bundle',
	sourcemap: 'inline',
	minify: false,
	bytecode: true, // Optimal performance,
	plugins: [
		dts()
	  ],
});

if (!build.success) {
	console.error('build failed:', build.logs);
	process.exit(1);
}

// Build the bin script from src/bin/index.ts without bytecode
// const binBuild = await Bun.build({
// 	// entrypoints: ['bin/index.js'],
// 	entrypoints: ['src/bin/index.ts'],
// 	external: ['*'],
// 	outdir: 'dist/bin',
// 	target: 'bun',
// 	format: 'esm', // Required for bytecode with bun target
// 	splitting: false,
// 	packages: 'external',
// 	sourcemap: 'inline',
// 	minify: false,
// 	bytecode: false, // Optimal performance
// 	plugins: [
// 		dts()
// 	  ],
// });

// if (!binBuild.success) {
// 	console.error('binBuild failed:', binBuild.logs);
// 	process.exit(1);
// }

// experimental build by bundling bin and pkg to one
// const binBuild = await Bun.build({
// 	// entrypoints: ['bin/index.js'],
// 	entrypoints: ['src/bin/index.ts'],
// 	// external: ['*'],
// 	outdir: 'dist',
// 	target: 'bun',
// 	format: 'cjs', // Required for bytecode with bun target
// 	splitting: false,
// 	// packages: 'external',
// 	sourcemap: 'inline',
// 	minify: false,
// 	bytecode: true, // Optimal performance
// 	// plugins: [
// 	// 	dts()
// 	//   ],
// });

export {};
