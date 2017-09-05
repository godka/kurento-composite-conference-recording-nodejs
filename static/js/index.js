var ws = new WebSocket('wss://' + location.host + '/call');
var video;
var webRtcPeer;

window.onload = function () {
	video = document.getElementById('video');
}

window.onbeforeunload = function () {
	ws.close();
}

ws.onmessage = function (message) {
	var parsedMessage = JSON.parse(message.data);
	console.info('Received message: ' + message.data);

	switch (parsedMessage.id) {
		case 'response':
			response(parsedMessage);
			break;
		case 'stopCommunication':
			dispose();
			break;
		case 'error':
			console.error(message.data);
			break;
		default:
			console.log(message.data);
			break;
	}
}

function response(message) {
	console.log('SDP answer received from server. Processing ...');
	webRtcPeer.processAnswer(message.sdpAnswer);
}

function onIceCandidate(candidate) {
	console.log('Local candidate' + JSON.stringify(candidate));

	var message = {
		id: 'onIceCandidate',
		candidate: candidate
	};
	sendMessage(message);
}

function start() {
	console.log('Starting video call ...')
	showSpinner(video);
	console.log('Creating WebRtcPeer and generating local sdp offer ...');

	var options = {
		localVideo: video
	}

	webRtcPeer = kurentoUtils.WebRtcPeer.WebRtcPeerSendrecv(options, function (error) {
		if (error) return onError(error);
		this.generateOffer(function onOffer(error, offerSdp) {
			if (error) return onError(error);

			console.info('Invoking SDP offer callback function ' + location.host);
			var message = {
				id: 'client',
				sdpOffer: offerSdp
			}
			sendMessage(message);
		});
	});
}

function stop() {
	var message = {
		id: 'stop'
	}
	sendMessage(message);
	dispose();
}

function dispose() {
	if (webRtcPeer) {
		webRtcPeer.dispose();
		webRtcPeer = null;
	}
	hideSpinner(video);
}

function sendMessage(message) {
	var jsonMessage = JSON.stringify(message);
	console.log('Senging message: ' + jsonMessage);
	ws.send(jsonMessage);
}

function showSpinner() {
	for (var i = 0; i < arguments.length; i++) {
		arguments[i].poster = './img/transparent-1px.png';
		arguments[i].style.background = 'center transparent url("./img/spinner.gif") no-repeat';
	}
}

function hideSpinner() {
	for (var i = 0; i < arguments.length; i++) {
		arguments[i].src = '';
		arguments[i].poster = './img/webrtc.png';
		arguments[i].style.background = '';
	}
}
