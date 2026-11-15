# HL-CST

Half-Light Choices, Second Thoughts

A browser-only self-reflection tool. About a dozen small dilemmas; each round you pick one of three and answer it. At the end you get an evidence-backed description of how you make judgment calls, including where that description might be wrong. No scores, no personality types, no comparisons with other people.

- **Bring your own API key**: Claude, GPT, Gemini, DeepSeek, local models (Ollama, LM Studio), or any OpenAI-compatible service. Keys and records stay in your browser; requests go straight from your browser to the provider you choose.
- **Data retention differs by provider.** The Chinese README has a table; check each provider's official policy.
- **The interface is Chinese-only for now.**
- **Run locally**: `node tools/serve.mjs` in the repo root (or `python -m http.server 8000 --bind 127.0.0.1`), then open http://localhost:8000.
- **License**: code © 2026 二十骰子, licensed under the GNU AGPL-3.0-or-later (if you modify it and offer it to others, over a network or otherwise, you must publish your source under the same license); docs and content (`content/`, `design/`, `archive/`) CC BY-SA 4.0; vendored SDK Apache-2.0.
- **Contact**: `alexz_hlcst@163.com`. Enjoyed it or not, tell us how it felt, in any format, like a note to a friend.
