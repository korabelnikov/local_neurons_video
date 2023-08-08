import io
import json
import time

import mediapipe as mp
import numpy as np
from PIL import Image

BaseOptions = mp.tasks.BaseOptions
mp_face_mesh = mp.solutions.face_mesh
face_mesh = mp_face_mesh.FaceMesh(
    static_image_mode=True,
    max_num_faces=1,
    refine_landmarks=True,
    min_detection_confidence=0.5)

'''
message = await websocket.recv()
data = json.loads(message)
image_data = data['image']


image_data = base64.b64decode(image_data[23:])
nparr = np.frombuffer(image_data, np.uint8)

# call nn, convert to json

# Send the face landmarks data to the client
await websocket.send(results_json)

'''


async def mesh_solution_to_json(results): # mp.python.solution_base.SolutionOutputs
    results_json = ''

    if results.multi_face_landmarks and len(results.multi_face_landmarks) > 0:
        landmarks = results.multi_face_landmarks[0].landmark[:200]

        results_json = json.dumps({
            'multi_face_landmarks': [
                {'x': landmark.x, 'y': landmark.y, 'z': landmark.z}
                for landmark in landmarks
            ] if results.multi_face_landmarks else None
        })
    return results_json


async def process_image(frame):
    # Receive the image data from the client
    time0 = time.time()

    results = face_mesh.process(frame)

    print('nn proc time: ', time.time() - time0)
    return results

