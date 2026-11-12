from __future__ import annotations

import json
import re
from typing import Any, Dict, List

import httpx

_PERSONA = (
    "You are XiaoLee, a kawaii, smart, and genuinely helpful AI assistant "
    "for the XiaoLee platform on Solana. "
    "Your personality is warm, cheerful, and degen-friendly — like a crypto-native friend who "
    "actually knows her stuff. Use kawaii emojis naturally (🌸, ✨, 💕, 🚀, 💜). "
    "Keep responses conversational and human — 2 to 4 sentences for simple questions, "
    "more when real detail is needed. Never use markdown formatting (no asterisks, no bold). "
    "CRITICAL RULE: reply in the EXACT same language the user writes in. "
    "Portuguese in → Portuguese out. English in → English out. Never switch languages."
)

# Intent classification: always the fast flash model.
# gemini-flash-latest resolves to the latest Gemini Flash (currently gemini-3-flash-preview).
# Not a thinking model → deterministic JSON, sub-second latency.
_INTENT_MODEL = "gemini-flash-latest"

# Reply fallback: same fast model — always available, Gemini 3 Flash quality.
_REPLY_FALLBACK = "gemini-flash-latest"

# Heuristic language guess for the final reminder in generate_reply(). Naming the
# language explicitly ("reply in ENGLISH") steers the model far more reliably than a
# generic "mirror the user's language" rule, which loses to a Portuguese-heavy
# instruction block sitting right above it in the same system prompt.
_PT_HINTS = re.compile(
    r"[áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ]"
    r"|\b(voc[eê]|n[aã]o|est[aá]|para|com|meu|minha|quero|enviar|manda|mandar|saldo|"
    r"carteira|obrigad[oa]|beleza|oi|ol[aá])\b",
    re.IGNORECASE,
)


def _guess_language(text: str) -> str:
    return "Portuguese" if _PT_HINTS.search(text) else "English"


class GeminiClient:
    def __init__(self, api_key: str, model: str, anthropic_api_key: str = "", anthropic_model: str = ""):
        self.api_key = api_key
        # model = the premium model configured via GEMINI_MODEL env var
        self.model = model
        # Last resort for generate_reply when Gemini is down or out of credit (402 seen in prod).
        self.anthropic_api_key = anthropic_api_key
        self.anthropic_model = anthropic_model

    @property
    def enabled(self) -> bool:
        return bool(self.api_key)

    def _api_url(self, model: str) -> str:
        return (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{model}:generateContent"
        )

    _ERROR_PHRASES = frozenset([
        "No momento não consegui gerar resposta.",
        "Não consegui responder agora. Tenta de novo em um instante!",
        "Posso ajudar com saldo, cotação de swap e operações na Solana Devnet.",
    ])

    def _build_contents(self, user_text: str, history: list | None) -> List[Dict]:
        """Convert DB history (role: user/bot) to Gemini multi-turn contents array."""
        contents = []
        if history:
            for turn in history:
                role = turn.get("role", "")
                content = turn.get("content", "")
                if not content:
                    continue
                clean = re.sub(r"\[System Note:[^\]]+\]\s*", "", content).strip()
                if not clean:
                    continue
                # Skip error/fallback messages — they confuse the model.
                if any(phrase in clean for phrase in self._ERROR_PHRASES):
                    continue
                gemini_role = "model" if role == "bot" else "user"
                contents.append({"role": gemini_role, "parts": [{"text": clean}]})
        contents.append({"role": "user", "parts": [{"text": user_text}]})
        return contents

    async def _call(self, payload: Dict, model: str, timeout: float = 25) -> Dict:
        """Single HTTP call to a given Gemini model."""
        async with httpx.AsyncClient(timeout=timeout) as client:
            # Key in a header, not the URL: httpx logs request URLs, which leaked it to prod logs.
            resp = await client.post(
                self._api_url(model), json=payload, headers={"x-goog-api-key": self.api_key}
            )
            resp.raise_for_status()
            return resp.json()

    async def _call_with_fallback(self, payload: Dict) -> Dict:
        """Try the premium model (short timeout); on any failure use the fallback."""
        if self.model != _REPLY_FALLBACK:
            try:
                body = await self._call(payload, self.model, timeout=10)
                # Confirm response has actual content (thinking models can exhaust token budget)
                parts = (
                    body.get("candidates", [{}])[0]
                    .get("content", {})
                    .get("parts")
                )
                if parts:
                    return body
                print(f"[GeminiClient] {self.model} returned empty parts — falling back to {_REPLY_FALLBACK}")
            except Exception as e:
                print(f"[GeminiClient] {self.model} failed ({type(e).__name__}) — falling back to {_REPLY_FALLBACK}")

        return await self._call(payload, _REPLY_FALLBACK, timeout=25)

    async def _claude_reply(self, system_text: str, contents: List[Dict]) -> str:
        import anthropic

        messages: List[Dict] = []
        for c in contents:
            role = "assistant" if c["role"] == "model" else "user"
            text = c["parts"][0]["text"]
            if messages and messages[-1]["role"] == role:
                messages[-1]["content"] += "\n\n" + text
            elif messages or role == "user":
                messages.append({"role": role, "content": text})
        client = anthropic.AsyncAnthropic(api_key=self.anthropic_api_key, timeout=25, max_retries=1)
        resp = await client.messages.create(
            model=self.anthropic_model, max_tokens=1024, system=system_text, messages=messages
        )
        return "".join(b.text for b in resp.content if b.type == "text")

    # ------------------------------------------------------------------
    # Public interface
    # ------------------------------------------------------------------

    async def classify_intent(self, user_text: str, history: list = None) -> Dict[str, Any]:
        """Always uses the fast, non-thinking model for deterministic JSON output."""
        if not self.enabled:
            return {"action": "fallback", "confidence": 0.0, "entities": {}}

        clean = re.sub(r"\[System Note:[^\]]+\]\s*", "", user_text).strip()

        prompt = (
            "Classify the user's intent. Return ONLY valid JSON: "
            '{"action": "check_balance|swap_quote|swap_execute|campaign_info|greeting|help'
            '|run_campaign_agent|pay_creator|discover_creators|check_budget", '
            '"confidence": 0.0, "entities": {}}. '
            "Context: XiaoLee is an agentic DeFi app on Arc (Circle, USDC). "
            "run_campaign_agent = user wants the autonomous agent to run/execute a campaign; "
            "pay_creator = pay a creator in USDC (Arc/Circle nanopayment, cross-chain/CCTP); "
            "discover_creators = find/list eligible creators; "
            "check_budget = campaign USDC budget/treasury questions. "
            "Use confidence >= 0.8 only when intent is crystal clear. "
            "User message: " + clean
        )

        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.0, "responseMimeType": "application/json"},
        }

        try:
            body = await self._call(payload, _INTENT_MODEL, timeout=10)
        except Exception as e:
            print(f"Gemini classify_intent error: {e}")
            return {"action": "fallback", "confidence": 0.0, "entities": {}}

        text = (
            body.get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [{}])[0]
            .get("text", "{}")
        )

        try:
            parsed = json.loads(text)
        except Exception:
            return {"action": "fallback", "confidence": 0.0, "entities": {}}

        return {
            "action": parsed.get("action", "fallback"),
            "confidence": float(parsed.get("confidence", 0.0)),
            "entities": parsed.get("entities", {}),
        }

    async def generate_reply(
        self,
        instruction: str,
        user_text: str,
        history: list = None,
    ) -> str:
        """Generates the actual XiaoLee response using the best available model."""
        if not self.enabled:
            return "Posso ajudar com saldo, cotação de swap e operações na Solana Devnet."

        # The language rule already lives in _PERSONA and usually in `instruction`
        # (_PLATFORM_CONTEXT) too, but both sit at the *start* of a long system
        # block — easy for the model to deprioritize by the time it's generating,
        # especially when `instruction` itself is written in Portuguese (most
        # call sites are). A generic "mirror the user's language" reminder lost
        # to that (seen live: "send 1 usdc to 0x..." answered in Portuguese
        # despite English input) — naming the detected language explicitly is a
        # much stronger signal than asking the model to infer and mirror it.
        lang = _guess_language(user_text)
        system_text = (
            _PERSONA + "\n\n" + instruction + "\n\n"
            f"FINAL REMINDER, overrides any earlier phrasing: the user's message below "
            f"is in {lang}. Reply ONLY in {lang}, no matter what language the rest of "
            "this prompt is written in."
        )
        contents = self._build_contents(user_text, history)

        payload = {
            "system_instruction": {"parts": [{"text": system_text}]},
            "contents": contents,
            "generationConfig": {
                "temperature": 0.7,
                "maxOutputTokens": 1024,
            },
        }

        try:
            body = await self._call_with_fallback(payload)
        except Exception as e:
            print(f"Gemini generate_reply error: {type(e).__name__}")
            if self.anthropic_api_key:
                try:
                    return await self._claude_reply(system_text, contents)
                except Exception as ce:
                    print(f"Claude reply fallback error: {type(ce).__name__}")
            return "Não consegui responder agora. Tenta de novo em um instante! 🌸"

        return (
            body.get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [{}])[0]
            .get("text", "No momento não consegui gerar resposta.")
        )
