"""
media_storage.py — Cloudflare R2 (API S3) para a mídia bruta do Clipper.

O upload NÃO passa pelo backend: o app recebe uma URL pré-assinada e envia o
arquivo direto ao bucket (um vídeo de 1h tem GBs; o Railway não deve fazer proxy).
boto3 é síncrono, então as chamadas de rede vão por `asyncio.to_thread`.

Papel: armazenamento de TRABALHO, não destino final. O vídeo longo fica aqui
enquanto é transcrito, e os cortes enquanto o app os toca/baixa. Para onde o
creator guarda ou posta o corte (aparelho, TikTok, Drive…) é decidido em
`mobile/src/lib/clip-share.ts`.

Trocar de provedor: é API S3, então qualquer S3-compatível (AWS S3, MinIO local
para testes, Backblaze…) funciona só com `R2_ENDPOINT_URL` + chaves + bucket,
sem mudar código. Pendência: regra de expiração no bucket (ex.: apagar `media/`
depois de N dias) — hoje nada é apagado, exceto cortes substituídos.
"""

from __future__ import annotations

import asyncio
from functools import lru_cache

from server.settings import settings


class StorageNotConfigured(RuntimeError):
    pass


@lru_cache(maxsize=1)
def _client():
    endpoint = settings.r2_endpoint_url or (
        f"https://{settings.r2_account_id}.r2.cloudflarestorage.com" if settings.r2_account_id else ""
    )
    if endpoint.startswith("http://"):
        # Sem TLS só o "R2" falso de scripts/clipper_demo_seed.py (`http://localhost:9000`), e só em dev: as
        # credenciais do bucket iriam em texto puro. Checa o host também porque XIAOLEE_ENV vazio vira "dev".
        host = endpoint[len("http://"):].split("/")[0].split(":")[0]
        if host not in ("localhost", "127.0.0.1") or settings.environment != "dev":
            raise StorageNotConfigured("R2_ENDPOINT_URL sem TLS só é aceito para localhost em dev")
    if not (endpoint and settings.r2_access_key_id and settings.r2_secret_access_key and settings.r2_bucket):
        raise StorageNotConfigured("R2_ACCOUNT_ID (ou R2_ENDPOINT_URL)/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET não configurados")
    import boto3
    from botocore.config import Config

    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key,
        region_name=settings.r2_region,
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )


def presign_put(key: str, content_type: str, size_bytes: int, expires: int = 3600) -> str:
    """URL de PUT que só aceita este content-type e este tamanho exato (assinados)."""
    return _client().generate_presigned_url(
        "put_object",
        Params={
            "Bucket": settings.r2_bucket,
            "Key": key,
            "ContentType": content_type,
            "ContentLength": size_bytes,
        },
        ExpiresIn=expires,
    )


async def object_size(key: str) -> int | None:
    """Tamanho do objeto no bucket, ou None se ainda não existe."""
    from botocore.exceptions import ClientError

    try:
        head = await asyncio.to_thread(_client().head_object, Bucket=settings.r2_bucket, Key=key)
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
            return None
        raise
    return int(head["ContentLength"])


def presign_get(key: str, expires: int = 3600) -> str:
    """URL de leitura temporária — o ffmpeg lê o vídeo por ela sem baixar o arquivo inteiro."""
    return _client().generate_presigned_url(
        "get_object", Params={"Bucket": settings.r2_bucket, "Key": key}, ExpiresIn=expires
    )


async def upload_file(path: str, key: str, content_type: str) -> None:
    """Envia um arquivo local (o clipe renderizado) ao bucket."""
    await asyncio.to_thread(
        _client().upload_file, path, settings.r2_bucket, key, ExtraArgs={"ContentType": content_type}
    )


async def delete_object(key: str) -> None:
    await asyncio.to_thread(_client().delete_object, Bucket=settings.r2_bucket, Key=key)
