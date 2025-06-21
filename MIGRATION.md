# Migration Guide: Node.js to Bun Runtime Interface Client

This document outlines the key differences and migration considerations when moving from the original AWS Lambda Node.js Runtime Interface Client to the Bun-based version.

## Key Differences

| Feature | Node.js RIC | Bun RIC |
|---------|------------|---------|
| **Runtime** | Node.js | Bun |
| **Native Addons** | Uses C++ native addon for HTTP | Pure JavaScript/TypeScript with `Bun.fetch` |
| **Bytecode** | No bytecode compilation | Includes bytecode compilation for faster startup |
| **Build System** | Node-gyp + esbuild | Bun's native builder |

## Migration Steps

### Update the base image of the Lambda function

```dockerfile
# Before
FROM amazon/aws-lambda-nodejs:18

# After
FROM nakamorichi/bunric:20250622
```

### Update dependencies

Review your dependencies for compatibility with Bun. Most Node.js packages work with Bun, but there are some exceptions:

- Native Node.js modules that don't have Bun equivalents
- Packages that rely heavily on Node.js-specific internals

### Check environment variables

If your functions rely on specific Node.js environment variables, verify they work with Bun.

### Utilize Bun's features

Take advantage of Bun's optimizations:

- Use native [Bun APIs](https://bun.sh/docs/runtime/bun-apis) when possible
- Use Bun's integrated [SQL client](https://bun.sh/docs/api/sql) for database operations
- Use Bun's [bundler](https://bun.sh/docs/bundler) for optimized bytecode builds
- Use Bun's Jest-compatible [test runner](https://bun.sh/docs/cli/test) for tests

## Common Issues and Solutions

### Module Resolution

- **Issue**: Import paths resolving differently in Bun
- **Solution**: Use explicit file extensions in imports, especially for non-JS files

### Streaming API Differences

- **Issue**: Node.js streams vs Bun's streaming APIs
- **Solution**: Update to use Bun's fetch streaming or Web Streams API

### Performance Considerations

- Cold start times are typically improved with Bun
- Function execution speed is generally faster
- Memory usage may differ from Node.js

## Testing the Migration

1. Run locally using the Lambda Runtime Interface Emulator
2. Test with representative workloads
3. Monitor cold start times, execution times, and memory usage
4. Verify error handling behaves as expected

## Resources

- [Bun Documentation](https://bun.sh/docs)
- [AWS Lambda Container Documentation](https://docs.aws.amazon.com/lambda/latest/dg/lambda-images.html)
