"""
Interhuman YC Booth — LiveKit Agent
==============================
Two-phase interactive avatar agent using LiveKit Agents SDK.

Phase 1 (interactive, 0-90s):
  - AgentSession with Garry Tan persona (OpenAI Realtime or classic pipeline)
  - Interhuman signals from user video are injected into LLM chat context
  - Avatar demeanor adapts dynamically via signal injection

Phase 2 (reflection, after timer-up):
  - Frontend sends 'garry.timer-up' data message with full transcript + signals
  - Agent calls GPT for a structured Garry-style reflection
  - Agent uses generate_reply to deliver the reflection as Garry's speech
  - Agent sends 'garry.phase-change' messages back to the frontend

Architecture matches yc-booth but adds:
  - Dual-phase logic (interactive → reflecting → done)
  - Frontend data channel protocol for timer/phase sync
  - GPT reflection engine
"""

import asyncio
import json
import logging
import os
from pathlib import Path
from typing import Dict, Optional

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

from livekit.agents import (  # noqa: E402
    Agent,
    AgentSession,
    AutoSubscribe,
    JobContext,
    WorkerOptions,
    cli,
    room_io,
)
from livekit import rtc  # noqa: E402
from livekit.plugins import lemonslice  # noqa: E402
from openai import AsyncOpenAI  # noqa: E402

from interhuman_client import InterhumanClient  # noqa: E402
from video_stream_encoder import VideoStreamEncoder  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

for lib in ["websockets", "httpx", "httpcore"]:
    logging.getLogger(lib).setLevel(logging.WARNING)

# ─── Config ───────────────────────────────────────────────────────────────────

OPENAI_API_KEY = os.environ["OPENAI_API_KEY"]
INTERHUMAN_API_KEY = os.environ.get("INTERHUMAN_API_KEY", "")
REFLECT_MODEL = os.environ.get("OPENAI_REFLECT_MODEL", "gpt-4o")
LEMON_SLICE_AVATAR_ID = os.environ.get("LEMON_SLICE_AVATAR_ID", "")
LEMONSLICE_API_KEY = os.environ.get("LEMONSLICE_API_KEY", "")
# Server-side video analysis is OFF by default: the frontend publishes the camera
# to the stream-proxy (browser → Interhuman), not to the LiveKit room. Only enable
# this if the frontend is changed to publish the user's camera track to LiveKit.
AGENT_VIDEO_ANALYSIS = os.environ.get("AGENT_VIDEO_ANALYSIS", "").lower() in ("1", "true", "yes")

# ─── Scenario prompts ─────────────────────────────────────────────────────────

GARRY_BASE_PERSONA = """You are Garry Tan, President & CEO of Y Combinator. You are legendary for finding signal in noise — identifying the 1 in 100 founders who will break through and change the world. You have seen thousands of pitches. You are intellectually sharp, direct, occasionally blunt, but genuinely invested in helping founders improve. You notice not just WHAT people say but HOW they say it — confidence, conviction, energy, clarity.

# TONE
1. Speech-to-text handling: Silently correct likely transcription errors. Focus on what the user probably means.
2. Response length: Short and punchy. Like a real conversation. Don't monologue.
3. Plain text only: Your responses will be spoken aloud. No bullet points. No asterisks. No formatting.
4. Natural speech patterns: Use "look", "honestly", "here's the thing". Be direct.
5. Your output goes directly to speech synthesis. Sound like a real human."""

SOCIAL_SIGNAL_INSTRUCTIONS = """
# ACTIVE SOCIAL INTELLIGENCE

You will periodically receive [SOCIAL SIGNAL UPDATE] system messages describing the user's real-time non-verbal social signals detected from their video feed. These include: engagement, confusion, frustration, disengagement, agreement, disagreement, hesitation, interest, skepticism, stress, uncertainty, and confidence.

Each signal includes a RATIONALE — a natural-language description of the observed behavior. Always use the rationale to inform your response, never just the label.

React naturally. You are Garry Tan reading the room — not a robot announcing sensor data.

USE THESE SIGNALS NATURALLY:
- If hesitation detected → "You paused there. What's the thing you're not saying?"
- If energy is low → "You gotta bring more fire than that. Show me why this matters."
- If confusion on their face → "You look unsure about that yourself. What part are you still figuring out?"
- If confidence is high → Match their energy, go deeper.
- If stress detected → "Take a breath. Start from the beginning."

CRITICAL: Never announce "I detected a signal." Just react naturally. Do NOT make up signals you didn't receive.
"""

SCENARIOS = {
    "yc-pitch": {
        "instructions": f"""{GARRY_BASE_PERSONA}

You are doing a mock YC application interview. The founder is pitching you their startup.
- Listen carefully and ask sharp follow-up questions
- Push back where you smell uncertainty or weak conviction
- React naturally to their delivery — if they seem hesitant on a claim, probe it
- Keep each response concise (1-2 sentences) so the conversation stays dynamic
- Simulate the pressure of a real YC interview

{SOCIAL_SIGNAL_INSTRUCTIONS}""",

        "greeting_instructions": (
            "You just started a 90-second mock YC interview. "
            "Open with something like: 'Alright, I've got 90 seconds. Tell me what you're building and why you're the one to do it.' "
            "Keep it to 1-2 sentences. Be direct."
        ),

        "reflection_prompt": f"""{GARRY_BASE_PERSONA}

You just finished a 90-second mock YC interview with a founder. Now deliver your honest verdict.

Based on their pitch (transcript) and how they came across (social signals), give specific, actionable feedback:
- What landed well — moments where they showed real conviction and clarity
- What needs work — where hesitation, uncertainty, or weak delivery hurt their credibility
- One specific thing to do differently next time
- A closing verdict: are they ready? What's the unlock?

Be honest, sharp, and direct. Reference specific moments. Keep it to 5-6 sentences. No bullet points. Speak directly to them.""",
    },
    "sales-data-privacy": {
        "instructions": f"""{GARRY_BASE_PERSONA}

You are a skeptical enterprise buyer on a sales call. The sales rep is about to answer your data privacy question.
- Listen and follow up on anything vague or unconvincing
- Ask difficult follow-up questions a real enterprise buyer would ask
- React to their confidence level — if they sound uncertain, push harder
- Keep each response short (1-2 sentences) to maintain the pressure

{SOCIAL_SIGNAL_INSTRUCTIONS}""",

        "greeting_instructions": (
            "You are an enterprise buyer about to ask a hard data privacy question. "
            "Open with: 'Before we go any further — can you confidently tell me that our data is safe with you? Give me a straight answer.' "
            "Keep it to 1-2 sentences."
        ),

        "reflection_prompt": f"""{GARRY_BASE_PERSONA}, now as a sales delivery coach.

You just watched a sales rep answer an enterprise buyer's data privacy question under pressure. Coach them:
- Where did their delivery strengthen or weaken credibility?
- What specific moments hurt the sale?
- What should they do differently — concretely, not generically?

Keep it to 4-5 sentences. Be the coach who gives useful, specific feedback. No bullet points.""",
    },
}

DEFAULT_SCENARIO = "yc-pitch"


# ─── Interhuman signal processing ─────────────────────────────────────────────

async def process_video_for_social_signals(
    ctx: JobContext,
    interhuman_api_key: str,
    participant_identity: str,
    agent_session: AgentSession = None,
    phase_ref: dict = None,
):
    """Process video frames from a participant and analyze for social signals."""
    logger.info(f"Starting video analysis for participant: {participant_identity}")

    async with InterhumanClient(interhuman_api_key) as client:

        async def handle_signals(signal_data: Dict):
            if phase_ref and phase_ref.get("phase") != "interactive":
                return

            if signal_data.get("status") == "error":
                logger.error(f"Interhuman API error: {signal_data}")
                return
            if signal_data.get("status") in ("processing", "completed"):
                return

            if signal_data.get("status") == "result":
                signals = signal_data.get("signals", [])
                segment = signal_data.get("segment", "?")
                logger.info(f"Received signals for segment {segment}: {len(signals)} signals")

                # Store signals for later reflection
                if phase_ref is not None:
                    phase_ref.setdefault("signals", []).extend(signals)

                # Send to frontend via data channel
                data_payload = {
                    "type": "social_signals",
                    "signals": {"signals": signals},
                    "segment": segment,
                    "timestamp": asyncio.get_event_loop().time(),
                }
                await ctx.room.local_participant.publish_data(
                    json.dumps(data_payload).encode("utf-8"),
                    reliable=True,
                )

                # Inject into LLM context for real-time reaction
                if agent_session and signals:
                    high_signals = [s for s in signals if s.get("probability") == "high"]
                    if not high_signals:
                        return

                    signal_parts = []
                    for s in high_signals:
                        sig_type = s.get("type", "unknown")
                        rationale = s.get("rationale", "")
                        if rationale:
                            signal_parts.append(f"{sig_type} (rationale: {rationale})")
                        else:
                            signal_parts.append(sig_type)

                    context_message = (
                        f"[SOCIAL SIGNAL UPDATE] The user is currently displaying: "
                        f"{'; '.join(signal_parts)}. "
                        f"This is the MOST RECENT signal update — previous updates are outdated."
                    )

                    try:
                        SIGNAL_MSG_ID = "interhuman_social_signal"
                        agent = agent_session.current_agent
                        chat_ctx = agent.chat_ctx.copy()
                        chat_ctx.items = [
                            item for item in chat_ctx.items
                            if not (hasattr(item, "id") and item.id == SIGNAL_MSG_ID)
                        ]
                        chat_ctx.add_message(role="system", content=context_message, id=SIGNAL_MSG_ID)
                        await agent.update_chat_ctx(chat_ctx)
                        logger.info(f"Injected signal into LLM: {', '.join(s.get('type', '?') for s in high_signals)}")
                    except Exception as e:
                        logger.warning(f"Failed to inject signals into LLM context: {e}")

        client.set_signal_callback(handle_signals)
        encoder = VideoStreamEncoder(chunk_duration=5.0, fps=30.0)

        # Find participant
        participant = None
        for p in ctx.room.remote_participants.values():
            if p.identity == participant_identity:
                participant = p
                break

        if not participant:
            timeout = 30.0
            start_time = asyncio.get_event_loop().time()
            while not participant and (asyncio.get_event_loop().time() - start_time) < timeout:
                await asyncio.sleep(0.5)
                for p in ctx.room.remote_participants.values():
                    if p.identity == participant_identity:
                        participant = p
                        break

        if not participant:
            logger.error(f"Participant {participant_identity} did not join within timeout")
            return

        # Get video track
        video_track = None
        for pub in participant.track_publications.values():
            if pub.kind == rtc.TrackKind.KIND_VIDEO and pub.track:
                video_track = pub.track
                break

        if not video_track:
            timeout = 30.0
            start_time = asyncio.get_event_loop().time()
            while not video_track and (asyncio.get_event_loop().time() - start_time) < timeout:
                await asyncio.sleep(0.5)
                for pub in participant.track_publications.values():
                    if pub.kind == rtc.TrackKind.KIND_VIDEO and pub.track:
                        video_track = pub.track
                        break

        if not video_track:
            logger.error("No video track available for analysis")
            return

        video_stream = rtc.VideoStream(video_track)
        logger.info("Starting video frame processing...")

        try:
            async for frame_event in video_stream:
                if client._is_stopped:
                    break
                if phase_ref and phase_ref.get("phase") == "done":
                    break
                if participant_identity not in [p.identity for p in ctx.room.remote_participants.values()]:
                    await client.stop()
                    break

                frame = frame_event.frame
                current_time = asyncio.get_event_loop().time()

                video_chunk = await encoder.add_frame(frame, current_time)
                if video_chunk:
                    try:
                        if not hasattr(client, "_segment_counter"):
                            client._segment_counter = 1
                        segment_num = client._segment_counter
                        client._segment_counter += 1
                        await client.send_video_bytes(video_chunk, segment=segment_num)
                    except RuntimeError as e:
                        if "stopped" in str(e).lower():
                            break
                        logger.error(f"Error sending video chunk: {e}")
                    except Exception as e:
                        logger.error(f"Error sending video chunk: {e}")

        except asyncio.CancelledError:
            logger.info("Video frame processing cancelled")
        except Exception as e:
            logger.error(f"Error processing video frames: {e}", exc_info=True)
        finally:
            try:
                if not client._is_stopped:
                    await client.stop()
            except Exception:
                pass
            logger.info("Video analysis cleanup complete")


# ─── GPT reflection ───────────────────────────────────────────────────────────

async def generate_reflection(transcript: str, signals: list, system_prompt: str) -> str:
    """Generate a structured Garry-style reflection using GPT."""
    client = AsyncOpenAI(api_key=OPENAI_API_KEY)

    signal_lines = (
        "\n".join(
            f"- {s.get('type', '?')} ({s.get('probability', 'detected')}): {s.get('rationale', '')}"
            for s in signals
        )
        if signals
        else "(no delivery cues detected)"
    )

    signal_types = list({s.get("type", "") for s in signals}) if signals else []

    user_message = (
        f"What the person said:\n{transcript}\n\n"
        f"Delivery observations from video analysis:\n{signal_lines}\n\n"
        f"IMPORTANT: Only reference signals that were actually detected. "
        f"The detected signal types are: {', '.join(signal_types) if signal_types else 'none'}."
    )

    logger.info(f"Generating GPT reflection ({len(transcript)} chars, {len(signals)} signals)")

    response = await client.chat.completions.create(
        model=REFLECT_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        temperature=0.7,
        max_completion_tokens=350,
    )

    return response.choices[0].message.content or ""


# ─── Main agent entrypoint ────────────────────────────────────────────────────

async def entrypoint(ctx: JobContext):
    logger.info(f"Interhuman YC Booth agent starting in room: {ctx.room.name}")

    await ctx.connect(auto_subscribe=AutoSubscribe.SUBSCRIBE_ALL)
    logger.info(f"Connected to room: {ctx.room.name}")

    # Shared mutable state
    phase_ref = {"phase": "interactive", "scenario_id": DEFAULT_SCENARIO, "signals": []}

    try:
        # --- LLM setup (OpenAI as stand-in until LemonSlice SDK is ready) ---
        from livekit.plugins import openai as openai_plugin  # noqa: E402

        openai_model_type = os.environ.get("OPENAI_MODEL_TYPE", "realtime").lower()

        if openai_model_type == "realtime":
            llm = openai_plugin.realtime.RealtimeModel(voice="echo")
            session = AgentSession(llm=llm)
        else:
            openai_model = os.environ.get("OPENAI_MODEL", "gpt-4o")
            tts_voice = os.environ.get("TTS_VOICE", "echo")
            tts_instance = openai_plugin.TTS(voice=tts_voice, model="tts-1")

            llm = openai_plugin.LLM(model=openai_model)
            # No STT/VAD — Garry doesn't interrupt the user's pitch.
            # He speaks his greeting, then stays silent until the reflection phase.
            session = AgentSession(llm=llm, tts=tts_instance)

        logger.info("Agent session created")

        avatar_session = None
        if LEMON_SLICE_AVATAR_ID and LEMONSLICE_API_KEY:
            try:
                avatar_session = lemonslice.AvatarSession(
                    agent_id=LEMON_SLICE_AVATAR_ID,
                    agent_prompt=(
                        "Garry Tan on a YC-style pitch call: alert, direct, "
                        "engaged, skeptical when needed, but genuinely helpful."
                    ),
                    agent_idle_prompt="Garry Tan listening attentively on a video call.",
                    idle_timeout=-1,
                )
                avatar_session_id = await avatar_session.start(session, room=ctx.room)
                logger.info(f"LemonSlice avatar session started: {avatar_session_id}")
            except Exception as e:
                avatar_session = None
                logger.error(f"LemonSlice avatar failed to start; falling back to audio-only agent: {e}", exc_info=True)
        elif LEMON_SLICE_AVATAR_ID and not LEMONSLICE_API_KEY:
            logger.warning("LEMON_SLICE_AVATAR_ID set but LEMONSLICE_API_KEY missing — running audio-only agent")
        else:
            logger.warning("LEMON_SLICE_AVATAR_ID not set — running audio-only agent")

        # --- Listen for data messages from frontend ---
        async def _handle_data_received(data_packet):
            try:
                payload = json.loads(data_packet.data.decode("utf-8"))
                msg_type = payload.get("type")

                if msg_type == "garry.scenario":
                    scenario_id = payload.get("scenarioId", DEFAULT_SCENARIO)
                    phase_ref["scenario_id"] = scenario_id if scenario_id in SCENARIOS else DEFAULT_SCENARIO
                    logger.info(f"Scenario set: {phase_ref['scenario_id']}")

                    # Update agent instructions to match scenario
                    scenario = SCENARIOS[phase_ref["scenario_id"]]
                    try:
                        agent = session.current_agent
                        await agent.update_instructions(scenario["instructions"])
                        logger.info("Updated agent instructions for scenario")
                    except Exception as e:
                        logger.warning(f"Failed to update instructions: {e}")

                elif msg_type == "garry.timer-up":
                    logger.info("Timer-up received — starting reflection phase")
                    phase_ref["phase"] = "reflecting"

                    transcript = payload.get("transcript", "")
                    frontend_signals = payload.get("signals", [])
                    # Merge frontend signals with agent-detected signals
                    all_signals = phase_ref.get("signals", []) + frontend_signals

                    # Notify frontend of phase change
                    phase_msg = json.dumps({"type": "garry.phase-change", "phase": "reflecting"})
                    await ctx.room.local_participant.publish_data(phase_msg.encode(), reliable=True)

                    # Generate GPT reflection
                    scenario = SCENARIOS.get(phase_ref["scenario_id"], SCENARIOS[DEFAULT_SCENARIO])
                    reflection_text = await generate_reflection(
                        transcript=transcript,
                        signals=all_signals,
                        system_prompt=scenario["reflection_prompt"],
                    )
                    logger.info(f"GPT reflection generated ({len(reflection_text)} chars)")

                    # Deliver reflection as Garry's speech via generate_reply
                    session.generate_reply(
                        instructions=(
                            f"IMPORTANT: You are now delivering your final verdict/reflection. "
                            f"Say the following reflection VERBATIM as your next response. Do not add anything else. "
                            f"Just speak these words naturally:\n\n{reflection_text}"
                        )
                    )

                    # Stream reflection text to frontend for transcript panel
                    words = reflection_text.split()
                    chunk_size = 8
                    for i in range(0, len(words), chunk_size):
                        chunk = " ".join(words[i:i + chunk_size])
                        is_final = i + chunk_size >= len(words)
                        speech_msg = json.dumps({
                            "type": "garry.speech-chunk",
                            "text": chunk + (" " if not is_final else ""),
                            "isFinal": is_final,
                        })
                        await ctx.room.local_participant.publish_data(speech_msg.encode(), reliable=True)
                        await asyncio.sleep(0.1)

                    # Signal done
                    phase_ref["phase"] = "done"
                    done_msg = json.dumps({"type": "garry.phase-change", "phase": "done"})
                    await ctx.room.local_participant.publish_data(done_msg.encode(), reliable=True)

            except Exception as e:
                logger.debug(f"Non-control data packet: {e}")

        def on_data_received(data_packet):
            asyncio.create_task(_handle_data_received(data_packet))

        ctx.room.on("data_received", on_data_received)

        # --- Start Interhuman video analysis ---
        # Disabled by default — the browser streams the camera to the stream-proxy
        # for analysis, so no video track is published to the LiveKit room here.
        video_analysis_task = None
        if INTERHUMAN_API_KEY and AGENT_VIDEO_ANALYSIS:
            await asyncio.sleep(2.0)
            user_participant = None
            for participant in ctx.room.remote_participants.values():
                # Skip the LemonSlice avatar — we want the human user
                if "lemonslice" in participant.identity or "avatar" in participant.identity:
                    continue
                user_participant = participant
                logger.info(f"Found user participant: {participant.identity}")
                break

            if not user_participant:
                # Wait for user to join (up to 30s)
                timeout = 30.0
                start_time = asyncio.get_event_loop().time()
                while not user_participant and (asyncio.get_event_loop().time() - start_time) < timeout:
                    await asyncio.sleep(1.0)
                    for participant in ctx.room.remote_participants.values():
                        if "lemonslice" in participant.identity or "avatar" in participant.identity:
                            continue
                        user_participant = participant
                        logger.info(f"Found user participant (after wait): {participant.identity}")
                        break

            if user_participant:
                video_analysis_task = asyncio.create_task(
                    process_video_for_social_signals(
                        ctx, INTERHUMAN_API_KEY, user_participant.identity,
                        agent_session=session, phase_ref=phase_ref,
                    )
                )
                logger.info(f"Started social signal analysis for {user_participant.identity}")
            else:
                logger.warning("No remote participants found for video analysis")
        elif not INTERHUMAN_API_KEY:
            logger.warning("INTERHUMAN_API_KEY not set — social signal analysis disabled")
        else:
            logger.info("Agent-side video analysis disabled (AGENT_VIDEO_ANALYSIS off) — analysis runs via the browser stream-proxy")

        async def cleanup_video_analysis():
            if video_analysis_task and not video_analysis_task.done():
                video_analysis_task.cancel()
                try:
                    await video_analysis_task
                except asyncio.CancelledError:
                    pass

        ctx.add_shutdown_callback(cleanup_video_analysis)

        # --- Start the agent session ---
        scenario = SCENARIOS.get(phase_ref["scenario_id"], SCENARIOS[DEFAULT_SCENARIO])

        logger.info("Starting agent session...")
        await session.start(
            agent=Agent(instructions=scenario["instructions"]),
            room=ctx.room,
            room_options=room_io.RoomOptions(
                close_on_disconnect=False,
                audio_input=False,
            ),
        )
        logger.info("Agent session started")

        # Generate Garry's opening greeting
        session.generate_reply(instructions=scenario["greeting_instructions"])

    except Exception as e:
        logger.error(f"Failed to start agent: {e}", exc_info=True)
        raise


if __name__ == "__main__":
    logger.info("Starting Interhuman YC Booth agent worker...")
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            agent_name="Interhuman YC Booth",
        )
    )
