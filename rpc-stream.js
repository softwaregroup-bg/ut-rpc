var through2 = require('through2')

function get(obj, path) {
    if(Array.isArray(path)) {
        for(var i in path)
            obj = obj[path[i]]
        return obj
    }
    return obj[path]
}

module.exports = function (obj, opts) {
    opts = opts || {}
    var cbs = {}, count = 1, local = obj || {}
    var nameSpace = (opts.id || 'rpc') + '-';
    var flattenError = opts.flattenError || function (err) {
            if(!(err instanceof Error)) return err
            var err2 = { message: err.message }
            for(var k in err)
                err2[k] = err[k]
            return err2
        }
    function expandError(err) {
        if (!err || !err.message) return err
        var err2 = new Error(err.message)
        for(var k in err)
            err2[k] = err[k]
        return err2
    }

    if(obj) {
        local = {}
        function callable (k) {
            return function (args, cb) {
                return obj[k].apply(obj, cb ? args.concat(cb) : args)
            }
        }
        for(var k in obj)
            local[k] = obj[k]

    }
    var s = through2.obj(function (data, encoding, callback) {
        //write - on incoming call
        data = data.slice()
        var i = data.pop(), args = data.pop(), name = data.pop()
        //if(~i) then there was no callback.

        if (args[0]) args[0] = expandError(args[0])

        if(name != null) {
            var called = 0
            args.push(function () {
                if (called++) return
                var args = [].slice.call(arguments)
                args[0] = flattenError(args[0])
                if(~i) callback(undefined, [args, i]) //responses don't have a name.
            });
            try {
                local[name].apply(obj, args)
            } catch (err) {
                if(~i) callback(undefined, [[flattenError(err)], i])
            }
        } else if(!cbs[i]) {
            //there is no callback with that id.
            //either one end mixed up the id or
            //it was called twice.
            //log this error, but don't throw.
            //this process shouldn't crash because another did wrong

            callback('Invalid callback id:'+i);
        } else {
            //call the callback.
            var cb = cbs[i]
            delete cbs[i] //delete cb before calling it, incase cb throws.
            try {
                cb.apply(null, args);
            } finally {
                callback(undefined);
            }
        }
    })

    var rpc = s.rpc = function (name, args, cb) {
        if(cb) {
            count++
            cbs[nameSpace+count] = cb
        }
        if('string' !== typeof name)
            throw new Error('name *must* be string')
        s.emit('data', [name, args, cb ? (nameSpace+count) : -1])
        if(cb && count == 9007199254740992) count = 0 //reset if max
        //that is 900 million million.
        //if you reach that, dm me,
        //i'll buy you a beer. @dominictarr
    }

    function keys (obj) {
        var keys = []
        for(var k in obj) keys.push(k)
        return keys
    }

    s.createRemoteCall = function (name) {
        return function () {
            var args = [].slice.call(arguments)
            var cb = ('function' == typeof args[args.length - 1])
                ? args.pop()
                : null
            rpc(name, args, cb)
        }
    }

    s.createLocalCall = function (name, fn) {
        local[name] = fn
    }

    s.wrap = function (remote, _path) {
        _path = _path || []
        var w = {}
            ;(Array.isArray(remote)     ? remote
            : 'string' == typeof remote ? [remote]
            : remote = keys(remote)
        ).forEach(function (k) {
                w[k] = s.createRemoteCall(k)
            })
        return w
    }

    return s;
}
