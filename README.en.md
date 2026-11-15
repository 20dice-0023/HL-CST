# HL-CST

Half-Light Choices, Second Thoughts

A browser-only self-reflection tool with about a dozen small everyday dilemmas; in each group you pick one of three to answer. At the end you get a description of how you make judgment calls, with the evidence behind it and where it might be wrong. No scores, no personality types, no comparisons with other people.

- **Bring your own API key**: Claude, GPT, Gemini, DeepSeek, local models (Ollama, LM Studio), or any OpenAI-compatible service. Keys and records stay in your browser; requests go straight from your browser to the provider you choose.
- **Data retention differs by provider.** The Chinese README has a table; check each provider's official policy.
- **The interface is Chinese-only for now.**
- **Live site**: https://alexz.hl-cst.workers.dev (hosted on Cloudflare; it may be unreachable in some regions, in which case run it locally).
- **Run locally**: `node tools/serve.mjs` in the repo root (or `python -m http.server 8000 --bind 127.0.0.1`, which lists directories and does not check the Host header, so avoid it if the folder holds private files), then open http://localhost:8000.
- **License**: code © 2026 二十骰子, licensed under the GNU AGPL-3.0-or-later (if you modify it and offer it to others, over a network or otherwise, you must publish your source under the same license); docs and content (`content/`, `design/`, `archive/`) CC BY-SA 4.0; vendored SDK Apache-2.0.
- **Contact**: `alexz_hlcst@163.com`. However it went, tell this inbox how it felt, in any format, like messaging a friend from afar.
