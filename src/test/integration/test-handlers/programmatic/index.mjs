// ESM does not need 'use strict';

// Example of a standard ESM handler.
// The original programmatic test that called `run()` itself is not compatible
// with the standard RIE -> entrypoint.sh -> RIC flow if CMD is "index.handler".
// This is now a standard handler.
export const handler = async (event, context) => {
  console.log('Programmatic handler (now standard export) received event:', event);
  // To test if it can import from the main RIC package (dependency "aws-lambda-ric": "file:/app")
  // you could try:
  // import { someExportFromRIC } from 'aws-lambda-ric';
  // console.log(someExportFromRIC);
  return {
    message: "success from programmatic handler",
    eventReceived: event
  };
};
