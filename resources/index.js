export const handler = async (event, context) => {
    console.log('hello world');
    console.log('event', event);
    console.log('context', context);
    return 'success';
  };
