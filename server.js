/*
created by godka
2017年09月05日15:06:14
*/
var path = require('path');
var url = require('url');
var cookieParser = require('cookie-parser')
var express = require('express');
var session = require('express-session')
var minimist = require('minimist');
var ws = require('ws');
var kurento = require('kurento-client');
var fs = require('fs');
var https = require('https');
var options =
    {
        key: fs.readFileSync('keys/server.key'),
        cert: fs.readFileSync('keys/server.crt')
    };

var argv = minimist(process.argv.slice(2), {
    default: {
        as_uri: 'https://localhost:8443/',
        ws_uri: 'ws://1029.mythkast.net:8888/kurento'
    }
});

var composite = null;
var mediaPipeline = null;

var idCounter = 0;
var clients = {};
var kurentoClient = null;

function nextUniqueId() {
    idCounter++;
    return idCounter.toString();
}
/*
 * Server startup
 */

var app = express();

/*
 * Management of sessions
 */
app.use(cookieParser());

var sessionHandler = session({
    secret: 'none',
    rolling: true,
    resave: true,
    saveUninitialized: true
});

app.use(sessionHandler);

/*
 * Definition of global variables.
 */
var sessions = {};
var candidatesQueue = {};
var kurentoClient = null;

/*
 * Server startup
 */
var asUrl = url.parse(argv.as_uri);
var port = asUrl.port;
var server = https.createServer(options, app).listen(port, function () {
    console.log('Kurento Tutorial started');
    console.log('Open ' + url.format(asUrl) + ' with a WebRTC capable browser');
});

var wss = new ws.Server({
    server: server,
    path: '/call'
});

/*
 * Management of WebSocket messages
 */
wss.on('connection', function (ws) {
    var sessionId = nextUniqueId();

    console.log('Connection received with sessionId ' + sessionId);

    ws.on('error', function (error) {
        console.log('Connection ' + sessionId + ' error');
        stop(sessionId);
    });

    ws.on('close', function () {
        console.log('Connection ' + sessionId + ' closed');
        stop(sessionId);
    });

    ws.on('message', function (_message) {
        var message = JSON.parse(_message);
        //console.log('Connection ' + sessionId + ' received message ', message.id);

        switch (message.id) {
            case 'client':
                addClient(sessionId, message.sdpOffer, function (error, sdpAnswer) {
                    if (error) {
                        return ws.send(JSON.stringify({
                            id: 'response',
                            response: 'rejected',
                            message: error
                        }));
                    }
                    ws.send(JSON.stringify({
                        id: 'response',
                        response: 'accepted',
                        sdpAnswer: sdpAnswer
                    }));
                });
                break;

            case 'stop':
                stop(sessionId);
                break;

            case 'onIceCandidate':
                onIceCandidate(sessionId, message.candidate);
                break;

            default:
                console.log('error message:', message);
                ws.send(JSON.stringify({
                    id: 'error',
                    message: 'Invalid message ' + message
                }));
                break;
        }
    });
});

/*
 * Definition of functions
 */

// Retrieve or create kurentoClient
function getKurentoClient(callback) {
    console.log("getKurentoClient");
    if (kurentoClient !== null) {
        console.log("KurentoClient already created");
        return callback(null, kurentoClient);
    }

    kurento(argv.ws_uri, function (error, _kurentoClient) {
        console.log("creating kurento");
        if (error) {
            console.log("Coult not find media server at address " + argv.ws_uri);
            return callback("Could not find media server at address" + argv.ws_uri
                + ". Exiting with error " + error);
        }
        kurentoClient = _kurentoClient;
        callback(null, kurentoClient);
    });
}

// Retrieve or create mediaPipeline
function getMediaPipeline(callback) {
    if (mediaPipeline !== null) {
        console.log("MediaPipeline already created");
        return callback(null, mediaPipeline);
    }
    getKurentoClient(function (error, _kurentoClient) {
        if (error) {
            return callback(error);
        }
        _kurentoClient.create('MediaPipeline', function (error, _pipeline) {
            console.log("creating MediaPipeline");
            if (error) {
                return callback(error);
            }
            mediaPipeline = _pipeline;
            callback(null, mediaPipeline);
        });
    });
}

// Retrieve or create composite hub
function getComposite(callback) {
    if (composite !== null) {
        console.log("Composer already created");
        return callback(null, composite, mediaPipeline);
    }
    getMediaPipeline(function (error, _pipeline) {
        if (error) {
            return callback(error);
        }
        _pipeline.create('Composite', function (error, _composite) {
            console.log("creating Composite");
            if (error) {
                return callback(error);
            }
            composite = _composite;
            callback(null, composite);
        });
    });
}

// Create a hub port
function createHubPort(callback) {
    getComposite(function (error, _composite) {
        if (error) {
            return callback(error);
        }
        _composite.createHubPort(function (error, _hubPort) {
            console.info("Creating hubPort");
            if (error) {
                return callback(error);
            }
            callback(null, _hubPort);
        });
    });
}

// Create a webRTC end point
function createWebRtcEndPoint(callback) {
    getMediaPipeline(function (error, _pipeline) {
        if (error) {
            return callback(error);
        }
        _pipeline.create('WebRtcEndpoint', function (error, _webRtcEndpoint) {
            console.info("Creating createWebRtcEndpoint");
            if (error) {
                return callback(error);
            }

            callback(null, _webRtcEndpoint);
        });

    });
}

// Add a webRTC client
function addClient(id, sdp, callback) {

    clients[id] = {
        id: id,
        webRtcEndpoint: null,
        hubPort: null,
        recordRtcendpoint: null
    }

    createWebRtcEndPoint(function (error, _webRtcEndpoint) {
        if (error) {
            console.log("Error creating WebRtcEndPoint " + error);
            return callback(error);
        }
        clients[id].webRtcEndpoint = _webRtcEndpoint

        recordParams = {
            uri: "file:///tmp/test.webm"
            //The media server user must have wirte permissions for creating this file
        };

        getMediaPipeline(function (error, _pipeline) {
            if (error) {
                return callback(error);
            }
            console.log('Creating RecorderEndpoint', recordParams);
            _pipeline.create("RecorderEndpoint", recordParams, function (error, recorderEndpoint) {
                if (error) {
                    console.log("Recorder problem");
                    return sendError(res, 500, error);
                }
                recorderEndpoint.record();
                clients[id].recordRtcendpoint = recorderEndpoint;

                createHubPort(function (error, _hubPort) {
                    if (error) {
                        stop(id);
                        console.log("Error creating HubPort " + error);
                        return callback(error);
                    }
                    clients[id].hubPort = _hubPort;

                    clients[id].recordRtcendpoint.connect(clients[id].hubPort);
                    clients[id].hubPort.connect(clients[id].recordRtcendpoint);


                    clients[id].webRtcEndpoint.connect(clients[id].hubPort);
                    clients[id].hubPort.connect(clients[id].webRtcEndpoint);




                    clients[id].webRtcEndpoint.processOffer(sdp, function (error, sdpAnswer) {
                        if (error) {
                            stop(id);
                            console.log("Error processing offer " + error);
                            return callback(error);
                        }
                        callback(null, sdpAnswer);
                    });
                });
            });
        });
    });
}

// Stop and remove a webRTC client
function stop(id) {
    if (clients[id]) {
        if (clients[id].webRtcEndpoint) {
            clients[id].webRtcEndpoint.release();
        }
        if (clients[id].hubPort) {
            clients[id].hubPort.release();
        }
        delete clients[id];
    }
    if (Object.getOwnPropertyNames(clients).length == 0) {
        if (composite) {
            composite.release();
            composite = null;
        }
        if (mediaPipeline) {
            mediaPipeline.release();
            mediaPipeline = null;
        }
    }
}

app.use(express.static(path.join(__dirname, 'static')));