FROM aws-lambda-bun-ric:latest

# Copy function code
COPY index.mjs package.json ./

# Install dependencies (if any)
RUN bun install --production

# Set the handler for the Lambda function
CMD ["index.handler"]
