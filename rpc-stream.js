var through2 = require('through2');

module.exports = function(obj, opts) {
    opts = opts || {};
    var cbs = {};
    var count = 1;
    var local = obj || {};
    var nameSpace = (opts.id || 'rpc') + '-';
    var flattenError = opts.flattenError || function(err) {
        if (!(err instanceof Error)) { return err; }
        var err2 = {message: err.message, stackInfo: err.stack.split('\n')};
        Object.keys(err).forEach(function(k) {
            err2[k] = err[k];
        });
        return err2;
    };

    function expandError(err) {
        if (!err || !err.stackInfo) { return err; }
        var err2 = new Error(err.message);
        Object.keys(err).forEach(function(k) {
            err2[k] = err[k];
        });
        return err2;
    }

    if (obj) {
        local = {};
        for (var k in obj) { local[k] = obj[k]; }
    }

    var s = through2.obj(function(data, encoding, callback) {
        // write - on incoming call
        data = data.slice();
        var i = data.pop();
        var args = data.pop();
        var name = data.pop();
        // if(~i) then there was no callback.

        if (args[0]) { args[0] = expandError(args[0]); }

        if (name != null) {
            Promise.resolve()
                .then(() => local[name].apply(obj, args))
                .then(result => {
                    if (~i) {
                        this.push([[null, result], i]);
                    }
                    return i;
                }, error => {
                    if (~i) {
                        this.push([[flattenError(error)], i]);
                    }
                })
                .catch(() => {}); // ignore secondary errors
            callback();
        } else if (!cbs[i]) {
            // there is no callback with that id.
            // either one end mixed up the id or
            // it was called twice.
            // log this error, but don't throw.
            // this process shouldn't crash because another did wrong

            callback(new Error('Invalid callback id:' + i));
        } else {
            // call the callback.
            var cb = cbs[i];
            delete cbs[i]; // delete cb before calling it, incase cb throws.
            try {
                cb.apply(null, args);
            } finally {
                callback();
            }
        }
    });

    var rpc = s.rpc = function(name, args, cb) {
        if (cb) {
            count++;
            cbs[nameSpace + count] = cb;
        }
        if (typeof name !== 'string') {
            throw new Error('name *must* be string');
        }
        s.emit('data', [name, args, cb ? (nameSpace + count) : -1]);
        if (cb && count === 9007199254740992) { count = 0; } // reset if max
        // that is 900 million million.
        // if you reach that, dm me,
        // i'll buy you a beer. @dominictarr
    };

    function keys(obj) {
        var keys = [];
        for (var k in obj) { keys.push(k); }
        return keys;
    }

    s.createRemoteCall = function(name) {
        return function() {
            var args = [].slice.call(arguments);
            var cb = (typeof args[args.length - 1] === 'function') ? args.pop() : null;
            rpc(name, args, cb);
        };
    };

    s.createLocalCall = function(name, fn) {
        local[name] = fn;
    };

    s.wrap = function(remote, _path) {
        _path = _path || [];
        var w = {};
        (Array.isArray(remote) ? remote : typeof remote === 'string' ? [remote] : remote = keys(remote)).forEach(function(k) {
            w[k] = s.createRemoteCall(k);
        });
        return w;
    };

    return s;
};
