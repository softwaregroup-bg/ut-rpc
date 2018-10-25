var rpc = require('./rpc-stream');
var MuxDemux = require('mux-demux');

function server(methods, isServer, log) {
    var rpcs = rpc(methods, {id: isServer ? 'bus' : 'port'});
    var mdm = MuxDemux({error: false});

    mdm.createLocalCall = rpcs.createLocalCall.bind(rpcs);
    mdm.createRemote = function createRemote(name, type) {
        if (type === 'req') {
            return rpcs.createRemoteCall(name);
        } else if (type === 'pub') {
            return rpcs.createRemoteCall(name); // todo handle pub/sub
        } else {
            return createRemoteStream(name, type);
        }
    };

    function genManifest(methods) {
        var manifest = {};
        for (var name in methods) {
            manifest[name] = methods[name]._rpcType || 'async';
        }
        return manifest;
    }

    mdm.on('connection', function(con) {
        con.on('error', function(e) { log && log.error && log.error(e); });

        if (con.meta === 'rpc') {
            if (isServer) {
                con.pipe(rpcs).pipe(con);
            }
            return;
        }

        if (con.meta === 'meta') {
            con.write(genManifest(methods));
            return;
        }

        try {
            var stream = methods[con.meta[0]](con.meta.slice(1));
            if (stream.readable) {
                stream.pipe(con);
            }
            if (stream.writable) {
                con.pipe(stream);
            }
        } catch (err) {
            mdm.emit('error', err);
        }
    });

    var rpcStream = mdm.createStream('rpc');
    rpcStream.on('error', function(e) { log && log.error && log.error(e); });
    if (!isServer) {
        rpcs.pipe(rpcStream).pipe(rpcs);
    }
    var metaStream = mdm.createStream('meta');

    function createRemoteStream(name, type) {
        return function() {
            var args = [].slice.call(arguments);

            (typeof args[args.length - 1] === 'function') && args.pop();

            var streamArgs = [name].concat(args);

            var newStream = (
                type === 'readable' ? mdm.createReadStream(streamArgs)
                    : type === 'writable' ? mdm.createWriteStream(streamArgs)
                        : type === 'duplex' ? mdm.createStream(streamArgs)
                            : (function() { throw new Error('unknown stream type: ' + type); })()
            );
            newStream.autoDestroy = false;

            return newStream;
        };
    }

    metaStream.on('data', function(manifest) {
        var methods = {};
        for (var name in manifest) {
            if (manifest[name] === 'async') {
                methods[name] = rpcs.createRemoteCall(name);
            } else {
                methods[name] = createRemoteStream(name, manifest[name]);
            }
        }
        mdm.emit('remote', methods);
    });

    return mdm;
}

module.exports = function(obj, isServer, log) {
    return server(obj, isServer, log);
};

module.exports.readable = function(fn, args) {
    fn._rpcType = 'readable';
    return fn;
};

module.exports.writable = function(fn, args) {
    fn._rpcType = 'writable';
    return fn;
};

module.exports.duplex = function(fn, args) {
    fn._rpcType = 'duplex';
    return fn;
};
