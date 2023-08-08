const canvas = document.getElementById('canvas');
let context = canvas.getContext('2d');
const video = document.getElementById('video');

// peer connection & data channel
var pc = null;
var dc = null, dcInterval = null;

function createPeerConnection() {
    var config = {
        sdpSemantics: 'unified-plan'
    };

    pc = new RTCPeerConnection(config);

    // register some listeners to help debugging
    pc.addEventListener('icegatheringstatechange', function() {
        console.log(pc.iceGatheringState);
    }, false);

    pc.addEventListener('iceconnectionstatechange', function() {
        console.log(pc.iceConnectionState);
    }, false);

    pc.addEventListener('signalingstatechange', function() {
        console.log(pc.signalingState);
    });
    // connect audio / video
    pc.addEventListener('track', function(evt) {
        video.srcObject = evt.streams[0];
    });

    return pc;
}

function negotiate() {
    return pc.createOffer().then(function(offer) {
        return pc.setLocalDescription(offer);
    }).then(function() {
        // wait for ICE gathering to complete
        return new Promise(function(resolve) {
            if (pc.iceGatheringState === 'complete') {
                resolve();
            } else {
                function checkState() {
                    if (pc.iceGatheringState === 'complete') {
                        pc.removeEventListener('icegatheringstatechange', checkState);
                        resolve();
                    }
                }
                pc.addEventListener('icegatheringstatechange', checkState);
            }
        });
    }).then(function() {
        var offer = pc.localDescription;
        var codec = "H264/90000"; // "default" "VP8/90000"
        if (codec !== 'default') {
            offer.sdp = sdpFilterCodec('video', codec, offer.sdp);
        }

        console.log('offer-sdp');
        console.log(offer.sdp);

        return fetch('/offer', {
            body: JSON.stringify({
                sdp: offer.sdp,
                type: offer.type,
                video_transform: "none"
            }),
            headers: {
                'Content-Type': 'application/json'
            },
            method: 'POST'
        });
    }).then(function(response) {
        return response.json();
    }).then(function(answer) {
        console.log('answer-sdp');
        console.log(answer.sdp);
        return pc.setRemoteDescription(answer);
    }).catch(function(e) {
        alert(e);
    });
}

function start() {
    pc = createPeerConnection();

    var time_start = null;

    function current_stamp() {
        if (time_start === null) {
            time_start = new Date().getTime();
            return 0;
        } else {
            return new Date().getTime() - time_start;
        }
    }

    //use-datachannel
    var parameters = {"ordered": false,
        "maxRetransmits": 1, "maxPacketLifetime": 500};

    dc = pc.createDataChannel('chat', parameters);
    dc.onclose = function() {
        clearInterval(dcInterval);
        console.log('- close\n');
    };
    dc.onopen = function() {
        console.log('- open\n');
        // dcInterval = setInterval(function() {
        //     var message = 'ping ' + current_stamp();
        //     console.log(message + '\n');
        //     dc.send(message);
        // }, 1000);
    };
    dc.onmessage = function(event) {
        let results = new Float32Array(event.data); // realshape of it 2xN
        const N = results.length / 2;

        const w = video.offsetWidth;
        const h = video.offsetHeight;
        context.clearRect(0, 0, context.canvas.width, context.canvas.height);
        for (let i = 0; i < N; i++) {
            let x = results[2 * i] * w;
            let y = results[2 * i + 1] * h;
            context.fillRect(x, y, 4, 4);
        }
    };

    var constraints = {
        audio: false,
        video: false
    };

    constraints.video = {
        width: 640,
        height: 480
    };

    navigator.mediaDevices.getUserMedia(constraints)
        .then(stream => {
            stream.getTracks().forEach(track => pc.addTrack(track, stream));

            video.srcObject = stream;
            video.play();
            return negotiate();
        })
        .catch(err => {
            console.error('Error accessing the webcam: ', err);
        });

}

function stop() {
    // close data channel
    if (dc) {
        dc.close();
    }

    // close local audio / video
    pc.getSenders().forEach(function(sender) {
        sender.track.stop();
    });

    // close peer connection
    setTimeout(function() {
        pc.close();
    }, 500);
}

function sdpFilterCodec(kind, codec, realSdp) {
    var allowed = []
    var rtxRegex = new RegExp('a=fmtp:(\\d+) apt=(\\d+)\r$');
    var codecRegex = new RegExp('a=rtpmap:([0-9]+) ' + escapeRegExp(codec))
    var videoRegex = new RegExp('(m=' + kind + ' .*?)( ([0-9]+))*\\s*$')
    
    var lines = realSdp.split('\n');

    var isKind = false;
    for (var i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('m=' + kind + ' ')) {
            isKind = true;
        } else if (lines[i].startsWith('m=')) {
            isKind = false;
        }

        if (isKind) {
            var match = lines[i].match(codecRegex);
            if (match) {
                allowed.push(parseInt(match[1]));
            }

            match = lines[i].match(rtxRegex);
            if (match && allowed.includes(parseInt(match[2]))) {
                allowed.push(parseInt(match[1]));
            }
        }
    }

    var skipRegex = 'a=(fmtp|rtcp-fb|rtpmap):([0-9]+)';
    var sdp = '';

    isKind = false;
    for (var i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('m=' + kind + ' ')) {
            isKind = true;
        } else if (lines[i].startsWith('m=')) {
            isKind = false;
        }

        if (isKind) {
            var skipMatch = lines[i].match(skipRegex);
            if (skipMatch && !allowed.includes(parseInt(skipMatch[2]))) {
                continue;
            } else if (lines[i].match(videoRegex)) {
                sdp += lines[i].replace(videoRegex, '$1 ' + allowed.join(' ')) + '\n';
            } else {
                sdp += lines[i] + '\n';
            }
        } else {
            sdp += lines[i] + '\n';
        }
    }

    return sdp;
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

function on_video_resize(element) {
    canvas.offsetLeft = element.offsetLeft;
    canvas.offsetTop = element.offsetTop;
    canvas.width = element.offsetWidth;
    canvas.height = element.offsetHeight;
}

window.onload = start
