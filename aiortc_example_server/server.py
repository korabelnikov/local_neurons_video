import argparse
import asyncio
import json
import logging
import os
import uuid
from typing import Callable

import numpy as np
from aiohttp import web
from aiortc import MediaStreamTrack, RTCPeerConnection, RTCSessionDescription
from aiortc.mediastreams import MediaStreamError

from nn_processor import process_image

ROOT = os.path.dirname(__file__)

logger = logging.getLogger("pc")
pcs = set()
data_channel = None


class VideoProcess():
    def __init__(self, track, processor: Callable, data_channel):
        self.processor = processor
        self.track = track
        self.data_channel = data_channel
        self.task = asyncio.ensure_future(self.__run_track(self.track))
        #self.__run_track(self.track)

    async def stop(self):
        """
        Stop recording.
        """
        if self.task is not None:
            self.task.cancel()
            self.task = None
        self.track = None

    async def __run_track(self, track: MediaStreamTrack):
        while True:
            try:
                frame = await track.recv()

                ts = frame.time + frame.time_base
                # convert PIL Image to OpenCv Image
                img = frame.to_ndarray(format="rgb24")

                results = await self.processor(img)

                try:
                    n_results = len(results.multi_face_landmarks)
                except:
                    n_results = 0

                if n_results > 0:
                    # results = await mesh_solution_to_json(results)
                    # results = json.dumps(results)
                    # to binary form
                    results = np.array([[it.x, it.y] for it in results.multi_face_landmarks[0].landmark])
                    results = results.astype(np.float32)[10:21]
                    results = results.tobytes()

                    if self.data_channel is None:
                        self.data_channel = data_channel
                    if data_channel is None:
                        print('dc not created. ')
                        continue

                    if self.data_channel.readyState == 'open':
                        self.data_channel.send(results)  # send the result via datachannel
                    else:
                        print('dc not open. ', self.data_channel.readyState)
            except MediaStreamError as e:
                print('MediaStreamError', e)

async def index(request):
    content = open(os.path.join(ROOT, "index.html"), "r").read()
    return web.Response(content_type="text/html", text=content)


async def javascript(request):
    content = open(os.path.join(ROOT, "client.js"), "r").read()
    return web.Response(content_type="application/javascript", text=content)


async def offer(request):
    params = await request.json()
    offer = RTCSessionDescription(sdp=params["sdp"], type=params["type"])

    pc = RTCPeerConnection()
    pc_id = "PeerConnection(%s)" % uuid.uuid4()
    pcs.add(pc)

    def log_info(msg, *args):
        logger.info(pc_id + " " + msg, *args)

    log_info("Created for %s", request.remote)
    @pc.on("datachannel")
    def on_datachannel(channel):
        print('on_datachannel')
        global data_channel
        data_channel = channel

        @channel.on("message")
        def on_message(message):
            if isinstance(message, str) and message.startswith("ping"):
                channel.send("pong" + message[4:])

    @pc.on("connectionstatechange")
    async def on_connectionstatechange():
        log_info("Connection state is %s", pc.connectionState)
        if pc.connectionState == "failed":
            await pc.close()
            pcs.discard(pc)

    @pc.on("track")
    def on_track(track):
        log_info("Track %s received", track.kind)

        if track.kind == "video":
            VideoProcess(track, process_image, data_channel)

        @track.on("ended")
        async def on_ended():
            log_info("Track %s ended", track.kind)

    # handle offer
    await pc.setRemoteDescription(offer)

    # send answer
    answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    return web.Response(
        content_type="application/json",
        text=json.dumps(
            {"sdp": pc.localDescription.sdp, "type": pc.localDescription.type}
        ),
    )


async def on_shutdown(app):
    # close peer connections
    coros = [pc.close() for pc in pcs]
    await asyncio.gather(*coros)
    pcs.clear()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="WebRTC audio / video / data-channels demo"
    )
    parser.add_argument(
        "--host", default="127.0.0.1", help="Host for HTTP server (default: 0.0.0.0)"
    )
    parser.add_argument(
        "--port", type=int, default=8080, help="Port for HTTP server (default: 8080)"
    )
    args = parser.parse_args()

    logging.basicConfig(level=logging.CRITICAL)

    ssl_context = None

    app = web.Application()
    app.on_shutdown.append(on_shutdown)
    app.router.add_get("/", index)
    app.router.add_get("/client.js", javascript)
    app.router.add_post("/offer", offer)
    web.run_app(
        app, access_log=None, host=args.host, port=args.port, ssl_context=ssl_context
    )