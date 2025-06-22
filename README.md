# bunric - AWS Lambda Bun Runtime Interface Client

**bunric** provides an AWS Lambda Runtime Interface Client (RIC) for the [Bun JavaScript runtime](https://bun.sh). It's a migration of the original Node.js-based AWS Lambda Runtime Interface Client to use Bun instead, offering improved performance and faster cold start times.

## Usage

Recommended way is to use the [optimized bunric image](https://hub.docker.com/repository/docker/nakamorichi/bunric).

In case you want to use custom image, you e.g. refer to the [Dockerfile](./Dockerfile) regarding how to build such.

## Links

- **NPM Package**: [@aawa/bunric](https://www.npmjs.com/package/@aawa/bunric)
- **Git Repository**: [nakamorichi/bunric](https://github.com/nakamorichi/bunric)
- **Docker Hub**: [nakamorichi/bunric](https://hub.docker.com/repository/docker/nakamorichi/bunric)

## Features

- **Pure JavaScript/TypeScript Implementation**: No native C++ dependencies, uses `Bun.fetch` for all HTTP communication
- **Improved Performance**: Leverages Bun's fast startup and execution for better Lambda cold start times
- **Full Lambda Runtime API Compliance**: Complete implementation of AWS Lambda Runtime Interface specification
- **ES Modules Support**: Built with modern ES modules and TypeScript
- **Streaming Response Support**: Handles both standard and streaming Lambda responses
- **Multi-tenant Logging**: Supports tenant ID logging for multi-tenant applications
- **Production Ready**: Comprehensive error handling, structured logging, and robust testing

## Architecture & Key Features

### Pure JavaScript/TypeScript Implementation
- **No Native Dependencies**: Eliminates C++ native addons used in the original Node.js RIC
- **Bun.fetch Integration**: Uses Bun's optimized HTTP client for all Lambda Runtime API communication
- **Simplified Build Process**: No need for node-gyp or C++ compilation

### Performance Optimizations
1. **Fast Cold Starts**: Leverages Bun's rapid startup time
2. **Efficient HTTP Communication**: Uses Bun's native fetch implementation
3. **ES Modules**: Modern module system for better performance
4. **TypeScript Support**: Full TypeScript support with type checking
5. **Streaming Responses**: Supports Lambda streaming response mode

### Lambda Runtime API Compliance
- Complete implementation of AWS Lambda Runtime Interface specification
- Support for all Lambda lifecycle events (init, invocation, error handling)
- Multi-tenant logging with tenant ID support
- Proper error formatting and reporting

## Project Structure

```
├── src/                    # Source code for the RIC implementation
│   ├── pkg/               # Core RIC packages
│   │   ├── Runtime.ts     # Main runtime orchestrator
│   │   ├── RAPIDClient.ts # Lambda Runtime API client
│   │   ├── UserFunction.ts# Handler loading and execution
│   │   └── ...           # Other core modules
│   ├── bin/              # RIC executable entrypoint
│   └── scripts/          # Build and utility scripts
├── dist/                  # Compiled RIC package (created during build)
├── examples/              # Example Lambda functions
│   └── simple-function/   # Basic example with Dockerfile
├── test/                  # Comprehensive test suite
│   ├── unit/             # Unit tests
│   └── integration/      # Integration tests
├── entrypoint.js         # Docker entrypoint script
└── Dockerfile            # Base image for Lambda functions
```

## Development

### Requirements

- Bun 1.0.0 or higher
- Docker for building and running containers
- TypeScript for development (included in devDependencies)

### Building from Source

```bash
# Clone the repository
git clone https://github.com/nakamorichi/bunric.git
cd bunric

# Install dependencies
bun install

# Run type checking
bun run typecheck

# Run tests
bun run tests

# Build the package
bun run build

# Build Docker image
docker build -t nakamorichi/bunric:latest .
```

### Testing

```bash
# Run unit tests
bun run tests

# Run integration tests
make test-integ

# Run smoke tests
make test-smoke
```

## Configuration

### Environment Variables

- `DEBUG=1` - Enable debug logging in the entrypoint script
- `LAMBDA_TASK_ROOT` - Directory where Lambda function code is located (defaults to `/var/task`)
- `AWS_LAMBDA_RUNTIME_API` - Lambda Runtime Interface API endpoint (set by AWS Lambda)
- `AWS_LAMBDA_FUNCTION_NAME` - Lambda function name (set by AWS Lambda)
- `AWS_LAMBDA_FUNCTION_VERSION` - Lambda function version (set by AWS Lambda)

## Migration from Node.js RIC

If you're migrating from the Node.js-based AWS Lambda Runtime Interface Client, see [MIGRATION.md](MIGRATION.md) for detailed guidance including:

- Key differences between Node.js and Bun RIC
- Step-by-step migration instructions
- Common issues and solutions
- Performance considerations

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Development Workflow

1. Make your changes
2. Run the verification steps:
   ```bash
   bun run typecheck  # TypeScript compilation
   bun run lint       # Linting
   bun run tests      # All tests must pass
   bun run build      # Build verification
   ```
3. Submit a pull request

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.
