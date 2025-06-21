/**
 * Example AWS Lambda function using Bun runtime
 * This handler demonstrates a simple Lambda function running on Bun
 */

export async function handler(event, context) {
  console.log('Event:', JSON.stringify(event, null, 2));
  console.log('Context:', JSON.stringify(context, null, 2));
  
  // Get environment information
  const runtime = {
    bun: process.versions.bun,
    node: process.versions.node,
    os: process.platform,
    arch: process.arch,
    memory: `${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB`,
    env: process.env.AWS_EXECUTION_ENV || 'custom',
    cpu: process.cpuUsage()
  };

  // Calculate response time
  const startTime = Date.now();
  
  // Perform some operations to demonstrate Bun performance
  const iterations = 1000000;
  let counter = 0;
  for (let i = 0; i < iterations; i++) {
    counter += i;
  }
  
  const executionTime = Date.now() - startTime;

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: 'Hello from AWS Lambda with Bun runtime!',
      timestamp: new Date().toISOString(),
      runtime,
      performance: {
        iterations,
        executionTime: `${executionTime}ms`,
      }
    }, null, 2)
  };
}
