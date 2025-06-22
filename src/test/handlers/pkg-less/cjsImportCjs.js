const { getMessage } = require('./cjsModule.cjs');

exports.handler = async (_event) => {
	return getMessage();
};
