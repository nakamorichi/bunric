// Echo handler for Docker integration tests
// Simple handler that echoes back the input event

exports.handler = async (event, context) => {
    console.log('Echo handler received event:', JSON.stringify(event));
    console.log('Echo handler context:', {
        functionName: context.functionName,
        functionVersion: context.functionVersion,
        requestId: context.awsRequestId
    });
    
    // Echo back the event with some additional metadata
    return {
        echo: event,
        timestamp: new Date().toISOString(),
        requestId: context.awsRequestId,
        message: 'Hello from Bun Lambda RIC!'
    };
};
