"""
Confiança no chamador do chat.

`/chat` e `/v1/messages/inbound` são HTTP abertos: `user_id` e `platform` vêm do
corpo e o `Bearer` pode ser qualquer string (o modo legado de
`resolve_twitter_identity` a aceita). Quem entra por aí sem um token que o
backend emitiu é *não verificado* e não pode acionar tools que mexem em dinheiro
ou em dados de outra pessoa. Os bots (Telegram/X) chamam o orquestrador direto,
com a identidade que o próprio canal já autenticou, e seguem como antes — por
isso o padrão é `False` e só o HTTP aberto liga a marca.
"""
from contextvars import ContextVar

unverified_caller: ContextVar[bool] = ContextVar("unverified_caller", default=False)
