# Interhuman YC Booth

Interactive pitch-practice demo. You pitch a startup to an AI **Garry Tan** (President & CEO of Y Combinator) for 90 seconds, then receive a structured, Garry-style reflection. Garry is rendered as a talking avatar and reacts in real time to your delivery — confidence, conviction, energy, clarity — using live social-signal analysis of your camera.

Built on:

- **[LiveKit](https://livekit.io)** — real-time audio/video transport and the agent runtime
- **[LemonSlice](https://lemonslice.com)** — the talking-head avatar for Garry
- **[Interhuman AI](https://interhuman.ai)** — real-time social-signal detection from the user's video
- **[OpenAI](https://openai.com)** — Garry's persona (Realtime API or STT+LLM+TTS) and the final reflection
- **[Next.js](https://nextjs.org)** — frontend, deployed on Vercel

## How it works

The experience runs in two phases:

1. **Interactive (0–90s)** — A LiveKit agent voices the Garry Tan persona. Live social signals from your camera are injected into the LLM's context so the avatar's demeanor adapts as you speak.
2. **Reflection** — When the timer ends, the frontend ships the full transcript + signals to the agent, which calls GPT for a structured Garry-style reflection and delivers it as speech.

## Architecture

Three independently deployable services:

| Directory       | Stack                          | Responsibility                                                                                   |
| --------------- | ------------------------------ | ------------------------------------------------------------------------------------------------ |
| `frontend/`     | Next.js 15, React 19, Tailwind | UI, LiveKit token minting, `/api/reflect`, demo-stream session tokens                            |
| `agent/`        | Python, LiveKit Agents SDK     | The Garry persona, avatar session (LemonSlice), reflection engine, optional in-room video analysis |
| `stream-proxy/` | Node.js, `ws`                  | WebSocket proxy that fans the browser's audio/video windows out to Interhuman + Whisper          |

By default the **browser publishes the camera to `stream-proxy`** for analysis (the `browser → stream-proxy → Interhuman` path). Agent-side, in-room video analysis is **off by default** and only used if you change the frontend to publish the camera track into the LiveKit room (`AGENT_VIDEO_ANALYSIS=true`).

## Prerequisites

- Node.js 20+ and [pnpm](https://pnpm.io) 9+
- Python 3.11+
- A [LiveKit Cloud](https://cloud.livekit.io) project (or self-hosted server)
- API keys: OpenAI, Interhuman AI, and (optionally) LemonSlice

## Environment variables

Copy the example files and fill them in. **Never commit real `.env` files** — they're gitignored.

```bash
cp frontend/.env.example frontend/.env.local
cp agent/.env.example agent/.env
```

### Frontend (`frontend/.env.local`)

| Variable                         | Required | Notes                                                                 |
| -------------------------------- | -------- | --------------------------------------------------------------------- |
| `OPENAI_API_KEY`                 | yes      | Used by `/api/reflect` and the stream-proxy (Whisper)                 |
| `OPENAI_REFLECT_MODEL`           | no       | Reflection model (default `gpt-4o`)                                   |
| `LIVEKIT_URL`                    | yes      | `wss://your-project.livekit.cloud`                                    |
| `LIVEKIT_API_KEY`                | yes      |                                                                       |
| `LIVEKIT_API_SECRET`             | yes      |                                                                       |
| `DEMO_STREAM_PROXY_URL`          | yes      | WebSocket URL of the stream-proxy                                     |
| `DEMO_STREAM_PROXY_TOKEN_SECRET` | yes      | **Must be set to a strong 32+ char secret in production.** Shared with the stream-proxy to sign short-lived session tokens. |

### Agent (`agent/.env`)

| Variable               | Required | Notes                                                            |
| ---------------------- | -------- | ---------------------------------------------------------------- |
| `OPENAI_API_KEY`       | yes      |                                                                  |
| `OPENAI_MODEL_TYPE`    | no       | `realtime` (voice-native) or `classic` (STT+LLM+TTS)             |
| `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | yes | LiveKit credentials                          |
| `INTERHUMAN_API_KEY`   | no       | Enables social-signal analysis                                   |
| `LEMONSLICE_API_KEY`   | no       | Both LemonSlice vars required to render the avatar; otherwise audio-only |
| `LEMON_SLICE_AVATAR_ID`| no       |                                                                  |
| `AGENT_VIDEO_ANALYSIS` | no       | `true` only if the frontend publishes the camera into the LiveKit room |

> The `stream-proxy` also reads `INTERHUMAN_API_KEY`, `OPENAI_API_KEY`, and `DEMO_STREAM_PROXY_TOKEN_SECRET` from its environment.

## Local development

Run the three services in separate terminals.

```bash
# 1. Stream proxy
cd stream-proxy
pnpm install
pnpm dev            # ws://localhost:8787/v1/demo/stream

# 2. LiveKit agent
cd agent
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python agent.py dev

# 3. Frontend
cd frontend
pnpm install
pnpm dev            # http://localhost:3000
```

## Deployment

- **Frontend** deploys to Vercel (root directory: `frontend`, framework auto-detected via `vercel.json`).
- **Agent** deploys to [LiveKit Cloud Agents](https://docs.livekit.io/agents/ops/deployment/) (see `agent/livekit.toml`).
- **Stream proxy** is a long-lived WebSocket server; deploy it to any Node host that supports persistent connections.

## License

MIT
