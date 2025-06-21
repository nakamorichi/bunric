/**
 * Module Initialization Optimization
 * Part of Phase 2: Core Performance Enhancements
 */

/**
 * Module initialization priority levels
 */
export enum InitPriority {
	CRITICAL = 0, // Must load immediately (core runtime)
	HIGH = 1, // Load early (common functionality)
	MEDIUM = 2, // Load when needed (optional features)
	LOW = 3, // Load lazily (rarely used features)
	DEFERRED = 4, // Load only when explicitly requested
}

/**
 * Module metadata for initialization optimization
 */
export interface ModuleMetadata {
	name: string;
	priority: InitPriority;
	dependencies: string[];
	estimatedLoadTime: number; // in milliseconds
	memoryFootprint: number; // estimated bytes
	loader: () => Promise<any> | any;
	loaded: boolean;
	loadedModule?: any;
	loadStartTime?: number;
	loadEndTime?: number;
}

/**
 * Module initialization optimizer with dependency resolution and parallel loading
 */
export class ModuleInitOptimizer {
	private modules = new Map<string, ModuleMetadata>();
	private loadingPromises = new Map<string, Promise<any>>();
	private loadOrder: string[] = [];
	private stats = {
		totalModules: 0,
		loadedModules: 0,
		totalLoadTime: 0,
		parallelLoadTime: 0,
		memoryUsed: 0,
	};

	/**
	 * Register a module for optimized initialization
	 */
	registerModule(metadata: ModuleMetadata): void {
		this.modules.set(metadata.name, {
			...metadata,
			loaded: false,
		});
		this.stats.totalModules++;
	}

	/**
	 * Initialize modules based on priority and dependencies
	 */
	async initializeModules(
		targetPriority: InitPriority = InitPriority.HIGH,
	): Promise<void> {
		const startTime = performance.now();

		// Get modules to load based on priority
		const modulesToLoad = Array.from(this.modules.values())
			.filter((module) => module.priority <= targetPriority && !module.loaded)
			.sort((a, b) => {
				// Sort by priority first, then by estimated load time (faster first)
				if (a.priority !== b.priority) {
					return a.priority - b.priority;
				}
				return a.estimatedLoadTime - b.estimatedLoadTime;
			});

		// Build dependency graph and load in optimal order
		const loadGroups = this.buildLoadGroups(modulesToLoad);

		// Load modules in parallel within each group
		for (const group of loadGroups) {
			await this.loadModuleGroup(group);
		}

		this.stats.parallelLoadTime = performance.now() - startTime;
	}

	/**
	 * Build groups of modules that can be loaded in parallel
	 */
	private buildLoadGroups(modules: ModuleMetadata[]): ModuleMetadata[][] {
		const groups: ModuleMetadata[][] = [];
		const processed = new Set<string>();
		const remaining = new Map(modules.map((m) => [m.name, m]));

		while (remaining.size > 0) {
			const currentGroup: ModuleMetadata[] = [];

			// Find modules with no unresolved dependencies
			for (const [name, module] of remaining.entries()) {
				const hasUnresolvedDeps = module.dependencies.some(
					(dep) => !processed.has(dep) && remaining.has(dep),
				);

				if (!hasUnresolvedDeps) {
					currentGroup.push(module);
				}
			}

			// If no modules can be loaded, break circular dependencies
			if (currentGroup.length === 0) {
				// Load the module with the highest priority (lowest number)
				const remainingModules = Array.from(remaining.values());
				if (remainingModules.length > 0) {
					const nextModule = remainingModules.sort(
						(a, b) => a.priority - b.priority,
					)[0];
					if (nextModule) {
						currentGroup.push(nextModule);
					}
				}
			}

			// Remove processed modules from remaining
			for (const module of currentGroup) {
				remaining.delete(module.name);
				processed.add(module.name);
			}

			if (currentGroup.length > 0) {
				groups.push(currentGroup);
			}
		}

		return groups;
	}

	/**
	 * Load a group of modules in parallel
	 */
	private async loadModuleGroup(group: ModuleMetadata[]): Promise<void> {
		const loadPromises = group.map((module) => this.loadModule(module));
		await Promise.all(loadPromises);
	}

	/**
	 * Load a single module with timing and error handling
	 */
	private async loadModule(metadata: ModuleMetadata): Promise<any> {
		if (metadata.loaded) {
			return metadata.loadedModule;
		}

		// Check if already loading
		const existingPromise = this.loadingPromises.get(metadata.name);
		if (existingPromise) {
			return existingPromise;
		}

		const loadPromise = this.performModuleLoad(metadata);
		this.loadingPromises.set(metadata.name, loadPromise);

		try {
			const result = await loadPromise;
			return result;
		} finally {
			this.loadingPromises.delete(metadata.name);
		}
	}

	/**
	 * Perform the actual module loading with metrics
	 */
	private async performModuleLoad(metadata: ModuleMetadata): Promise<any> {
		metadata.loadStartTime = performance.now();

		try {
			const module = await metadata.loader();

			metadata.loadEndTime = performance.now();
			metadata.loaded = true;
			metadata.loadedModule = module;

			const loadTime = metadata.loadEndTime - metadata.loadStartTime;
			this.stats.totalLoadTime += loadTime;
			this.stats.loadedModules++;
			this.stats.memoryUsed += metadata.memoryFootprint;
			this.loadOrder.push(metadata.name);

			return module;
		} catch (error) {
			metadata.loadEndTime = performance.now();
			throw new Error(`Failed to load module ${metadata.name}: ${error}`);
		}
	}

	/**
	 * Get a loaded module
	 */
	getModule<T = any>(name: string): T | undefined {
		const metadata = this.modules.get(name);
		return metadata?.loaded ? metadata.loadedModule : undefined;
	}

	/**
	 * Check if a module is loaded
	 */
	isModuleLoaded(name: string): boolean {
		return this.modules.get(name)?.loaded ?? false;
	}

	/**
	 * Load a specific module on demand
	 */
	async loadModuleOnDemand<T = any>(name: string): Promise<T> {
		const metadata = this.modules.get(name);
		if (!metadata) {
			throw new Error(`Module ${name} not registered`);
		}

		return this.loadModule(metadata);
	}

	/**
	 * Get comprehensive initialization statistics
	 */
	getStats() {
		const moduleStats = Array.from(this.modules.values()).map((module) => ({
			name: module.name,
			priority: InitPriority[module.priority],
			loaded: module.loaded,
			loadTime:
				module.loadStartTime && module.loadEndTime
					? module.loadEndTime - module.loadStartTime
					: 0,
			memoryFootprint: module.memoryFootprint,
			dependencies: module.dependencies.length,
		}));

		return {
			summary: this.stats,
			loadOrder: this.loadOrder,
			modules: moduleStats,
			efficiency: {
				parallelizationRatio:
					this.stats.totalLoadTime > 0
						? this.stats.parallelLoadTime / this.stats.totalLoadTime
						: 0,
				averageLoadTime:
					this.stats.loadedModules > 0
						? this.stats.totalLoadTime / this.stats.loadedModules
						: 0,
				memoryEfficiency: this.stats.memoryUsed / (1024 * 1024), // MB
			},
		};
	}

	/**
	 * Preload critical modules for faster cold starts
	 */
	async preloadCriticalModules(): Promise<void> {
		await this.initializeModules(InitPriority.CRITICAL);
	}

	/**
	 * Warm up commonly used modules
	 */
	async warmupModules(): Promise<void> {
		await this.initializeModules(InitPriority.HIGH);
	}

	/**
	 * Clear all modules and reset state
	 */
	clear(): void {
		this.modules.clear();
		this.loadingPromises.clear();
		this.loadOrder = [];
		this.stats = {
			totalModules: 0,
			loadedModules: 0,
			totalLoadTime: 0,
			parallelLoadTime: 0,
			memoryUsed: 0,
		};
	}
}

/**
 * Global module initialization optimizer
 */
export const globalModuleOptimizer = new ModuleInitOptimizer();

/**
 * Lambda runtime module registry with predefined modules
 */
export class LambdaModuleRegistry {
	private static initialized = false;

	/**
	 * Register all Lambda runtime modules with the optimizer
	 */
	static initialize(): void {
		if (LambdaModuleRegistry.initialized) return;

		// Critical modules - must load immediately
		globalModuleOptimizer.registerModule({
			name: 'BunRapidClient',
			priority: InitPriority.CRITICAL,
			dependencies: [],
			estimatedLoadTime: 5,
			memoryFootprint: 50 * 1024, // 50KB
			loader: () => import('../BunRapidClient.ts'),
			loaded: false,
		});

		globalModuleOptimizer.registerModule({
			name: 'RAPIDClient',
			priority: InitPriority.CRITICAL,
			dependencies: ['BunRapidClient'],
			estimatedLoadTime: 3,
			memoryFootprint: 30 * 1024, // 30KB
			loader: () => import('../RAPIDClient.ts'),
			loaded: false,
		});

		globalModuleOptimizer.registerModule({
			name: 'InvokeContext',
			priority: InitPriority.CRITICAL,
			dependencies: [],
			estimatedLoadTime: 2,
			memoryFootprint: 20 * 1024, // 20KB
			loader: () => import('../InvokeContext.ts'),
			loaded: false,
		});

		// High priority modules - load early
		globalModuleOptimizer.registerModule({
			name: 'UserFunction',
			priority: InitPriority.HIGH,
			dependencies: [],
			estimatedLoadTime: 8,
			memoryFootprint: 80 * 1024, // 80KB
			loader: () => import('../UserFunction.ts'),
			loaded: false,
		});

		globalModuleOptimizer.registerModule({
			name: 'Errors',
			priority: InitPriority.HIGH,
			dependencies: [],
			estimatedLoadTime: 3,
			memoryFootprint: 25 * 1024, // 25KB
			loader: () => import('../Errors.ts'),
			loaded: false,
		});

		globalModuleOptimizer.registerModule({
			name: 'LogPatch',
			priority: InitPriority.HIGH,
			dependencies: [],
			estimatedLoadTime: 4,
			memoryFootprint: 35 * 1024, // 35KB
			loader: () => import('../LogPatch.ts'),
			loaded: false,
		});

		// Medium priority modules - load when needed
		globalModuleOptimizer.registerModule({
			name: 'ResponseStream',
			priority: InitPriority.MEDIUM,
			dependencies: [],
			estimatedLoadTime: 6,
			memoryFootprint: 60 * 1024, // 60KB
			loader: () => import('../ResponseStream.ts'),
			loaded: false,
		});

		globalModuleOptimizer.registerModule({
			name: 'StreamingContext',
			priority: InitPriority.MEDIUM,
			dependencies: ['ResponseStream'],
			estimatedLoadTime: 5,
			memoryFootprint: 45 * 1024, // 45KB
			loader: () => import('../StreamingContext.ts'),
			loaded: false,
		});

		// Low priority modules - load lazily
		globalModuleOptimizer.registerModule({
			name: 'XRayError',
			priority: InitPriority.LOW,
			dependencies: [],
			estimatedLoadTime: 4,
			memoryFootprint: 30 * 1024, // 30KB
			loader: () => import('../XRayError.ts'),
			loaded: false,
		});

		globalModuleOptimizer.registerModule({
			name: 'HttpResponseStream',
			priority: InitPriority.LOW,
			dependencies: [],
			estimatedLoadTime: 7,
			memoryFootprint: 55 * 1024, // 55KB
			loader: () => import('../HttpResponseStream.ts'),
			loaded: false,
		});

		LambdaModuleRegistry.initialized = true;
	}

	/**
	 * Initialize Lambda runtime with optimized module loading
	 */
	static async initializeRuntime(): Promise<void> {
		LambdaModuleRegistry.initialize();
		await globalModuleOptimizer.preloadCriticalModules();
	}

	/**
	 * Warm up Lambda runtime for better performance
	 */
	static async warmupRuntime(): Promise<void> {
		LambdaModuleRegistry.initialize();
		await globalModuleOptimizer.warmupModules();
	}

	/**
	 * Get runtime initialization statistics
	 */
	static getRuntimeStats() {
		return globalModuleOptimizer.getStats();
	}
}

/**
 * Utility decorator for lazy module loading
 */
export function LazyModule(moduleName: string) {
	return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
		const originalMethod = descriptor.value;

		descriptor.value = async function (...args: any[]) {
			// Ensure module is loaded before calling method
			if (!globalModuleOptimizer.isModuleLoaded(moduleName)) {
				await globalModuleOptimizer.loadModuleOnDemand(moduleName);
			}

			return originalMethod.apply(this, args);
		};

		return descriptor;
	};
}
