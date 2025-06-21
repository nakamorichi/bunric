// ESM does not need 'use strict';

export const handler = async (event, context) => {
  console.log('hello world from echo.mjs');
  return 'success';
};
