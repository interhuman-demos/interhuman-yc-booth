"""
Video stream encoder for real-time video encoding from LiveKit frames.

This module handles encoding video frames directly into video chunks
for streaming to Interhuman AI, similar to MediaRecorder in the browser.
"""

import asyncio
import logging
from typing import Optional

import numpy as np
from livekit import rtc

logger = logging.getLogger(__name__)

TARGET_WIDTH = 640
TARGET_HEIGHT = 368  # multiple of 16 close to 360
SAMPLE_FPS = 10  # only keep 10 frames per second (sufficient for social signals)


class VideoStreamEncoder:
    """Encodes video frames in real-time into video chunks."""

    def __init__(self, chunk_duration: float = 5.0, fps: float = 30.0):
        self.chunk_duration = chunk_duration
        self.fps = fps
        self.sample_interval = int(round(fps / SAMPLE_FPS))
        self.frames: list[np.ndarray] = []
        self.chunk_start_time: Optional[float] = None
        self.frame_count = 0

    async def add_frame(self, frame: rtc.VideoFrame, current_time: float) -> Optional[bytes]:
        if self.chunk_start_time is None:
            self.chunk_start_time = current_time
            logger.info(f"Video encoder initialized: {frame.width}x{frame.height} @ {self.fps} fps (sampling {SAMPLE_FPS} fps, target {TARGET_WIDTH}x{TARGET_HEIGHT})")

        self.frame_count += 1

        # Only sample every Nth frame to reduce memory
        if self.frame_count % self.sample_interval != 0:
            return None

        # Convert and downscale immediately — store small numpy array only
        rgb_small = self._frame_to_small_rgb(frame)
        self.frames.append(rgb_small)

        # Check if we have a complete chunk
        if current_time - self.chunk_start_time >= self.chunk_duration:
            chunk_bytes = await self._encode_chunk()
            self.frames.clear()
            self.chunk_start_time = current_time
            return chunk_bytes

        return None

    async def _encode_chunk(self) -> bytes:
        if not self.frames:
            raise ValueError("No frames to encode")

        logger.info(f"Encoding video chunk: {len(self.frames)} frames, {TARGET_WIDTH}x{TARGET_HEIGHT}")
        return await self._encode_with_imageio()

    async def _encode_with_imageio(self) -> bytes:
        import imageio.v2 as iio
        import tempfile
        from pathlib import Path

        temp_video_path = None
        try:
            with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as temp_file:
                temp_video_path = temp_file.name

            try:
                writer = iio.get_writer(
                    temp_video_path,
                    fps=SAMPLE_FPS,
                    codec="libvpx",
                    quality=8,
                    ffmpeg_params=["-b:v", "500K", "-crf", "28"],
                )
            except Exception:
                logger.warning("VP8 codec not available, using H.264/MP4")
                temp_video_path = temp_video_path.replace(".webm", ".mp4")
                writer = iio.get_writer(
                    temp_video_path,
                    fps=SAMPLE_FPS,
                    codec="libx264",
                    quality=8,
                    pixelformat="yuv420p",
                    ffmpeg_params=["-preset", "ultrafast", "-crf", "28"],
                )

            for frame_array in self.frames:
                writer.append_data(frame_array)

            writer.close()

            with open(temp_video_path, "rb") as f:
                video_data = f.read()

            if len(video_data) == 0:
                raise RuntimeError("Encoded video is empty")

            return video_data
        finally:
            if temp_video_path and Path(temp_video_path).exists():
                try:
                    Path(temp_video_path).unlink()
                except Exception as e:
                    logger.warning(f"Failed to delete temp video file: {e}")

    def _frame_to_small_rgb(self, frame: rtc.VideoFrame) -> np.ndarray:
        """Convert LiveKit VideoFrame to a small RGB numpy array."""
        from PIL import Image

        rgba_frame = frame.convert(rtc.VideoBufferType.RGBA)
        frame_array = np.frombuffer(bytes(rgba_frame.data), dtype=np.uint8)
        frame_array = frame_array.reshape((frame.height, frame.width, 4))

        # Downscale via PIL (fast BILINEAR) and drop alpha
        img = Image.fromarray(frame_array, "RGBA").convert("RGB")
        img = img.resize((TARGET_WIDTH, TARGET_HEIGHT), Image.Resampling.BILINEAR)
        return np.array(img)

    def reset(self):
        """Reset the encoder state."""
        self.frames.clear()
        self.chunk_start_time = None
        self.frame_count = 0
