// Programmatic handler for Docker integration tests
// Demonstrates programmatic usage of the RIC

// Note: In a real scenario, you would import the RIC package
// For this test, we'll just export a regular handler since the RIC is globally available

// Simple handler function
const myHandler = async (event, context) => {
    console.log('Programmatic handler received event:', JSON.stringify(event));
    console.log('Programmatic handler context:', {
        functionName: context.functionName,
        functionVersion: context.functionVersion,
        requestId: context.awsRequestId
    });
    
    return {
        message: 'Hello from programmatic Bun Lambda RIC!',
        event: event,
        timestamp: new Date().toISOString(),
        requestId: context.awsRequestId,
        runtime: 'bun',
        mode: 'programmatic'
    };
};

// Export the handler for direct usage
exports.handler = myHandler;

// Note: In this Docker test scenario, the RIC is started by the entrypoint script
// The handler is invoked through the standard Lambda runtime interface
