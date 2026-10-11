import os
import json
import asyncio
from typing import Dict, List, Optional, Any
import openai
import httpx
from sqlalchemy import text
from database.database import init_db

class LLMClient:
    def __init__(self, provider: Optional[str] = None):
        # Active provider is env-driven (LLM_PROVIDER) so we can switch to Claude
        # without code changes; an explicit arg still wins for tests/overrides.
        self.provider = (provider or os.getenv("LLM_PROVIDER", "deepseek")).lower()
        self.db = init_db()

        if self.provider == "anthropic":
            api_key = os.getenv("ANTHROPIC_API_KEY")
            if not api_key:
                raise ValueError("Anthropic API key missing")

            # Lazy import so non-Claude deployments don't need the SDK installed.
            import anthropic
            self.client = anthropic.AsyncAnthropic(api_key=api_key)
            self.model = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")
        elif self.provider == "deepseek":
            api_key = os.getenv("DEEPSEEK_API_KEY")
            if not api_key:
                raise ValueError("DeepSeek API key missing")
            
            self.client = openai.AsyncOpenAI(
                api_key=api_key,
                base_url="https://api.deepseek.com/v1"
            )
            self.model = "deepseek-chat"
        elif self.provider == "openai":
            api_key = os.getenv("OPENAI_API_KEY")
            if not api_key:
                raise ValueError("OpenAI API key missing")
                
            self.client = openai.AsyncOpenAI(api_key=api_key)
            self.model = "gpt-4"
        elif self.provider == "gemini":
            api_key = os.getenv("GEMINI_API_KEY")
            if not api_key:
                raise ValueError("Gemini API key missing")
                
            self.client = openai.AsyncOpenAI(
                api_key=api_key,
                base_url="https://generativelanguage.googleapis.com/v1beta/openai/"
            )
            self.model = os.getenv("GEMINI_MODEL", "gemini-3.1-pro-preview")
        elif self.provider == "groq":
            # Free tier OpenAI-compatible — o mesmo LLM_PROVIDER que liga o Groq no
            # OrchestrationService (ver server/settings.py) não pode quebrar aqui.
            api_key = os.getenv("GROQ_API_KEY")
            if not api_key:
                raise ValueError("Groq API key missing")

            self.client = openai.AsyncOpenAI(
                api_key=api_key,
                base_url="https://api.groq.com/openai/v1"
            )
            self.model = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")
        elif self.provider == "ollama":
            self.base_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
            self.model = os.getenv("OLLAMA_MODEL", "llama2")
        else:
            raise ValueError(f"Provider not supported: {self.provider}")
    
    async def generate_response(self, message: str, user_id: str, tools: List[Dict] = None) -> str:
        try:
            user_context = await self._get_user_context(user_id)
            formatted_message = await self._format_message(message, user_context)
            
            if self.provider in ["deepseek", "openai", "gemini", "groq"]:
                return await self._generate_openai_style(formatted_message, tools)
            elif self.provider == "ollama":
                return await self._generate_ollama(formatted_message)
                
        except Exception as e:
            return f"Error: {str(e)}"
    
    async def generate_response_with_tools(
        self, message: str, user_id: str, tools: List[Dict], system_prompt: Optional[str] = None
    ) -> Dict[str, Any]:
        """Generate response with tool calling support - returns both text and tool calls"""
        try:
            prompt = system_prompt if system_prompt else self._get_system_prompt()

            if self.provider in ["deepseek", "openai", "gemini", "groq"]:
                messages = [
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": message}
                ]
                
                kwargs = {
                    "model": self.model,
                    "messages": messages,
                    "temperature": 0.7,
                    "max_tokens": 1500,
                }
                
                # Only add tools if we have any - empty array causes API error
                if tools:
                    kwargs["tools"] = tools
                    kwargs["tool_choice"] = "auto"
                
                response = await self.client.chat.completions.create(**kwargs)
                choice = response.choices[0]
                
                return {
                    "content": choice.message.content,
                    "tool_calls": choice.message.tool_calls,
                    "finish_reason": choice.finish_reason,
                    "usage": getattr(response, 'usage', None)  # Track token usage
                }
            else:
                # For Ollama or other providers without native tool support
                content = await self._generate_ollama_with_tools(message, tools)
                return {
                    "content": content,
                    "tool_calls": None,
                    "finish_reason": "stop"
                }
                
        except Exception as e:
            return {
                "content": f"Error: {str(e)}",
                "tool_calls": None,
                "finish_reason": "error"
            }

    async def _generate_ollama_with_tools(self, message: str, tools: List[Dict]) -> str:
        """Generate response for Ollama with simulated tool support"""
        # For Ollama, we'll simulate tool support by including tool descriptions in the prompt
        tool_descriptions = []
        for tool in tools:
            func = tool.get("function", {})
            name = func.get("name", "")
            description = func.get("description", "")
            if name and description:
                tool_descriptions.append(f"- {name}: {description}")
        
        tools_text = "\n".join(tool_descriptions) if tool_descriptions else "No tools available"
        
        enhanced_prompt = f"""You are Xiao Lee, a crypto waifu assistant!

Available tools:
{tools_text}

When a user asks for something you can help with using these tools, mention that you would use the appropriate tool, but since this is Ollama, please explain what would happen instead.

User: {message}
Assistant:"""
        
        return await self._generate_ollama(enhanced_prompt)
    
    async def continue_conversation_with_tool_results(self, messages: List[Dict], tools: List[Dict]) -> str:
        """Continue conversation after tool execution"""
        try:
            kwargs = {
                "model": self.model,
                "messages": messages,
                "temperature": 0.7,
                "max_tokens": 1500,
                "tools": tools,
                "tool_choice": "auto"
            }
            
            response = await self.client.chat.completions.create(**kwargs)
            return response.choices[0].message.content
            
        except Exception as e:
            return f"Error continuing conversation: {str(e)}"
    
    async def get_classification(self, classification_prompt: str) -> str:
        """
        Makes a direct, raw call to the LLM for a classification task.
        It uses a zero temperature for deterministic output and a small max_tokens.
        It does NOT inject the default system prompt or any other context.
        """
        try:
            if self.provider in ["deepseek", "openai", "gemini", "groq"]:
                messages = [
                    {"role": "user", "content": classification_prompt}
                ]
                
                kwargs = {
                    "model": self.model,
                    "messages": messages,
                    "temperature": 0.0,
                    "max_tokens": 5, # CONFIRM or CANCEL is short
                }
                
                response = await self.client.chat.completions.create(**kwargs)
                return response.choices[0].message.content.strip()
            else:
                # Ollama support
                 async with httpx.AsyncClient() as client:
                    response = await client.post(
                        f"{self.base_url}/api/generate",
                        json={
                            "model": self.model,
                            "prompt": classification_prompt,
                            "stream": False,
                            "options": {
                                "temperature": 0.0
                            }
                        }
                    )
                    result = response.json()
                    return result.get("response", "CANCEL").strip()

        except Exception as e:
            # On any exception, default to a non-destructive action for safety
            return "CANCEL"
    
    async def _generate_openai_style(self, message: str, tools: List[Dict] = None) -> str:
        messages = [
            {"role": "system", "content": self._get_system_prompt()},
            {"role": "user", "content": message}
        ]
        
        kwargs = {
            "model": self.model,
            "messages": messages,
            "temperature": 0.7,
            "max_tokens": 1500
        }
        
        if tools:
            kwargs["tools"] = tools
        
        response = await self.client.chat.completions.create(**kwargs)
        return response.choices[0].message.content
    
    async def _generate_ollama(self, message: str) -> str:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.base_url}/api/generate",
                json={
                    "model": self.model,
                    "prompt": f"{self._get_system_prompt()}\n\nUser: {message}\nAssistant:",
                    "stream": False
                }
            )
            result = response.json()
            return result.get("response", "No response")
    
    async def _get_user_context(self, user_id: str) -> Dict:
        try:
            async with self.db() as session:
                result = await session.execute(
                    text("SELECT twitter_handle, id FROM users WHERE twitter_user_id = :user_id"),
                    {"user_id": user_id}
                )
                user = result.fetchone()
                if not user:
                    return {"has_user": False, "has_wallet": False}

                user_handle, internal_user_id = user

                wallet_result = await session.execute(
                    text("SELECT address FROM wallets WHERE user_id = :user_id"),
                    {"user_id": internal_user_id}
                )
                wallet = wallet_result.fetchone()
                
                return {
                    "has_user": True,
                    "twitter_handle": user_handle,
                    "has_wallet": wallet is not None,
                    "wallet_address": wallet[0] if wallet else None
                }
        except Exception as e:
            print(f"Error in _get_user_context: {e}")
            return {"has_user": False, "has_wallet": False}
    
    async def _format_message(self, message: str, context: Dict) -> str:
        return message
    
    def _get_system_prompt(self) -> str:
        return """You are Xiao Lee, a cheerful crypto waifu assistant! 🌸

You have access to these tools - USE THEM when users ask for these operations:
- check_balance: When users ask about their token balances (user_id provided automatically)
- create_wallet: When users need a new wallet  
- get_swap_quote: When users ask for swap rates or quotes
- internal_swap: When users want to swap/trade tokens
- send_asset: When users want to send tokens to someone
- withdraw_asset: When users want to withdraw to external addresses
- list_campaigns: When users ask about available reward campaigns
- join_campaign: When users want to join a campaign
- claim_campaign_reward: When users want to claim rewards
- get_supported_tokens: When users ask what tokens are available
- list_my_campaigns: When users ask about their joined campaigns

IMPORTANT: 
- When a user asks for any of these operations, immediately use the appropriate tool
- For tools that need user_id, it's provided automatically - don't ask users for it
- Extract parameters from natural language (like "100 WIP for ZOO" → amount: 100, from_token: "WIP", to_token: "ZOO")

Be cheerful, helpful, and use emojis! Keep responses concise but informative.""" 