process.on('beforeExit', () => {
	setImmediate(() => console.log('from setImmediate'));
});

process.on('beforeExit', () => {
	process.nextTick(() => console.log('from process.nextTick'));
});

exports.callbackWithTrueFlag = (_event, _cxt, callback) => {
	callback(null, 'hello');
};

exports.callbackWithFalseFlag = (_event, cxt, callback) => {
	cxt.callbackWaitsForEmptyEventLoop = false;
	callback(null, 'hello');
};

exports.asyncFunction = async (_event) => {
	return 'hello';
};
