"""
Interhuman AI API Client for social signal analysis.

This module provides integration with Interhuman AI's API for analyzing
social signals from video streams using WebSocket streaming.
"""

import asyncio
import json
import logging
from typing import Dict, Optional, Callable, Awaitable

import aiohttp

logger = logging.getLogger(__name__)

# WebSocket close codes that should not trigger a reconnect attempt.
# 4000–4999 are application-defined. 1008 = policy violation.
_FATAL_CLOSE_CODES = frozenset({1008, 4000, 4001, 4003, 4004, 4008, 4029})

# Interhuman API error IDs that are fatal (quota, auth, bad request).
_FATAL_ERROR_IDS = frozenset({"ih3001", "ih3002", "ih3003", "ih4001", "ih4003", "ih4004"})


class InterhumanClient:
    """Client for Interhuman AI's social signal analysis API using WebSocket streaming."""

    def __init__(self, api_key: str, api_url: str = "https://api.interhuman.ai"):
        """
        Initialize the Interhuman AI client.

        Args:
            api_key: API key for authentication
            api_url: Base URL for the Interhuman AI API
        """
        self.api_key = api_key
        self.api_url = api_url.rstrip("/").replace("https://", "wss://").replace("http://", "ws://")
        self.session: Optional[aiohttp.ClientSession] = None
        self.ws: Optional[aiohttp.ClientWebSocketResponse] = None
        self.signal_callback: Optional[Callable[[Dict], Awaitable[None]]] = None
        self._receive_task: Optional[asyncio.Task] = None
        self._is_stopped = False
        self._reconnect_attempts = 0
        self.MAX_RECONNECT_ATTEMPTS = 5
        self._fatal_error = False  # set when a non-retryable API error is received

    async def __aenter__(self):
        """Async context manager entry."""
        self.session = aiohttp.ClientSession()
        # Connect to WebSocket
        await self._connect()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit."""
        # Stop recording if not already stopped
        if not self._is_stopped:
            await self.stop()
        else:
            await self._disconnect()
        
        if self.session:
            await self.session.close()

    async def _connect(self):
        """Connect to the WebSocket streaming endpoint."""
        ws_url = f"{self.api_url}/v1/stream/analyze"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
        }
        
        try:
            logger.info(f"🔌 Connecting to WebSocket: {ws_url}")
            self.ws = await self.session.ws_connect(
                ws_url,
                headers=headers,
                heartbeat=30,
            )
            logger.info(f"✅ Connected to Interhuman AI streaming endpoint (protocol: {self.ws.protocol})")
            
            # Start receiving messages
            self._receive_task = asyncio.create_task(self._receive_messages())
        except Exception as e:
            logger.error(f"Failed to connect to WebSocket: {e}")
            raise

    async def stop(self):
        """Stop recording and disconnect from the WebSocket."""
        logger.info("🛑 Stopping Interhuman AI client...")
        self._is_stopped = True
        await self._disconnect()

    async def _disconnect(self):
        """Disconnect from the WebSocket."""
        if self._receive_task:
            self._receive_task.cancel()
            try:
                await self._receive_task
            except asyncio.CancelledError:
                pass
        
        if self.ws and not self.ws.closed:
            try:
                await self.ws.close()
                logger.info("Disconnected from Interhuman AI streaming endpoint")
            except Exception as e:
                logger.warning(f"Error closing WebSocket: {e}")

    async def _receive_messages(self):
        """Receive and process messages from the WebSocket."""
        try:
            async for msg in self.ws:
                if msg.type == aiohttp.WSMsgType.TEXT:
                    try:
                        data = json.loads(msg.data)
                        logger.info(f"📨 Raw WS response: {msg.data[:500]}")

                        # The server sends `{"action": "error", ...}` frames when it cannot
                        # parse a message via its own discriminator (e.g. after a reconnect
                        # mid-session). These are protocol-level noise — ignore them.
                        if "action" in data and data.get("action") == "error":
                            logger.debug(f"Ignoring protocol-level action error: {data}")
                            continue

                        # Check for fatal API errors (quota, auth, bad request)
                        if data.get("status") == "error":
                            error_id = data.get("error_id", "")
                            error_msg = data.get("error") or data.get("message") or "Unknown error"
                            segment = data.get("segment", "?")
                            logger.error(f"API error (segment {segment}): {error_msg}")
                            if error_id in _FATAL_ERROR_IDS:
                                logger.error(
                                    f"Fatal API error ({error_id}) — reconnect suppressed. "
                                    f"See {data.get('link', 'https://docs.interhuman.ai')} for details."
                                )
                                self._fatal_error = True
                            if self.signal_callback:
                                await self.signal_callback(data)
                        else:
                            if self.signal_callback:
                                await self.signal_callback(data)
                    except json.JSONDecodeError as e:
                        logger.error(f"Failed to parse WebSocket message: {e} | raw: {msg.data[:200]}")
                elif msg.type == aiohttp.WSMsgType.BINARY:
                    logger.info(f"📨 Received binary WS message: {len(msg.data)} bytes")
                elif msg.type == aiohttp.WSMsgType.ERROR:
                    logger.error(f"WebSocket error: {self.ws.exception()}")
                elif msg.type == aiohttp.WSMsgType.CLOSE:
                    close_code = self.ws.close_code
                    logger.info(f"WebSocket closed by server (code: {close_code})")
                    break
        except asyncio.CancelledError:
            logger.info("WebSocket receive task cancelled")
        except Exception as e:
            logger.error(f"Error receiving WebSocket messages: {e}", exc_info=True)

        # Auto-reconnect with exponential backoff if not intentionally stopped
        if not self._is_stopped and not self._fatal_error and self.session and not self.session.closed:
            close_code = self.ws.close_code if self.ws else None
            if close_code in _FATAL_CLOSE_CODES:
                logger.error(f"Fatal WebSocket close code {close_code} — not retrying")
                return
            self._reconnect_attempts += 1
            if self._reconnect_attempts > self.MAX_RECONNECT_ATTEMPTS:
                logger.error(f"Max reconnect attempts ({self.MAX_RECONNECT_ATTEMPTS}) reached, giving up")
                return
            delay = min(2 ** self._reconnect_attempts, 30)
            logger.info(f"🔄 WebSocket dropped (close_code={close_code}), reconnecting in {delay}s (attempt {self._reconnect_attempts}/{self.MAX_RECONNECT_ATTEMPTS})...")
            await asyncio.sleep(delay)
            if self._is_stopped or self._fatal_error:
                return
            try:
                await self._connect()
                self._reconnect_attempts = 0
            except Exception as e:
                logger.error(f"Reconnect failed: {e}")

    def set_signal_callback(self, callback: Callable[[Dict], Awaitable[None]]):
        """
        Set a callback function to be called when signals are received.
        
        Args:
            callback: Async function that takes a dict of signals as argument
        """
        self.signal_callback = callback

    async def send_video_bytes(
        self, video_data: bytes, segment: Optional[int] = None
    ):
        """
        Send raw video bytes directly to the streaming endpoint.

        Args:
            video_data: Raw binary video data (e.g., WebM, MP4)
            segment: Optional segment number
        """
        if self._is_stopped:
            raise RuntimeError("Client has been stopped. Recording is no longer active.")

        if self._fatal_error:
            raise RuntimeError("Client encountered a fatal API error and cannot send further data.")
        
        if not self.ws or self.ws.closed:
            logger.warning("WebSocket closed, attempting reconnect before send...")
            try:
                await self._connect()
            except Exception as e:
                raise RuntimeError(f"WebSocket not connected and reconnect failed: {e}")

        if not video_data or len(video_data) == 0:
            raise ValueError("No video data provided")

        video_size = len(video_data)
        
        # Check minimum size requirement (10KB = 10240 bytes)
        if video_size < 10240:
            raise ValueError(
                f"Video chunk too small: {video_size} bytes (minimum: 10240 bytes)"
            )

        segment_num = segment if segment is not None else 1

        logger.info(
            f"Sending video chunk as binary: {video_size} bytes (segment: {segment_num})"
        )

        # Send JSON metadata frame before binary data
        metadata = json.dumps({
            "segment": segment_num,
            "size": video_size,
            "format": "webm",
        })
        await self.ws.send_str(metadata)

        # Send the raw binary video data directly via WebSocket
        await self.ws.send_bytes(video_data)
        logger.debug(f"Binary video chunk sent successfully (segment {segment_num})")

    def format_signals_for_display(self, signals: Dict[str, any]) -> str:
        """
        Format social signals for display in the UI.

        Args:
            signals: Raw signals from the API (expected format: {"signals": [...]})

        Returns:
            Formatted string for display
        """
        if "error" in signals:
            return f"Error: {signals['error']}"

        signals_list = signals.get("signals", [])
        if not signals_list:
            return "No signals detected"

        parts = []

        for signal in signals_list[:3]:
            signal_type = signal.get("type", "unknown")
            probability = signal.get("probability", "")
            if probability:
                parts.append(f"{signal_type} ({probability})")
            else:
                parts.append(signal_type)

        return " | ".join(parts) if parts else "No signals detected"
