
'use strict';
const noop = () => {};
module.exports = {
    initialize: noop,
    info: noop, warn: noop, error: noop, debug: noop,
    transports: {
        file: { level: 'info', maxSize: 0, format: '', getFile: () => ({ path: '/tmp/x.log' }) },
        console: { level: 'info' }
    }
};
