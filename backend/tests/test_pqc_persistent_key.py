"""PQC_REQUIRE_PERSISTENT_KEY: serviço que cobra não pode assinar com par efêmero em silêncio."""
import base64

import pytest

from services import pqc_receipt as mod

ML = pytest.importorskip("dilithium_py.ml_dsa").ML_DSA_87
b64 = lambda b: base64.b64encode(b).decode()


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    for k in ("PQC_SECRET_KEY", "PQC_PUBLIC_KEY", "PQC_REQUIRE_PERSISTENT_KEY"):
        monkeypatch.delenv(k, raising=False)
    mod._load_keypair.cache_clear()
    yield
    mod._load_keypair.cache_clear()


def test_flag_sem_chaves_recusa_efemero(monkeypatch):
    monkeypatch.setenv("PQC_REQUIRE_PERSISTENT_KEY", "true")
    with pytest.raises(RuntimeError, match="efêmero"):
        mod.assert_ready()


def test_flag_so_com_sk_recusa(monkeypatch):
    _, sk = ML.keygen()
    monkeypatch.setenv("PQC_REQUIRE_PERSISTENT_KEY", "true")
    monkeypatch.setenv("PQC_SECRET_KEY", b64(sk))
    with pytest.raises(RuntimeError):
        mod.assert_ready()


def test_flag_par_valido_sobe_e_assina_verificavel(monkeypatch):
    pk, sk = ML.keygen()
    monkeypatch.setenv("PQC_REQUIRE_PERSISTENT_KEY", "true")
    monkeypatch.setenv("PQC_SECRET_KEY", b64(sk))
    monkeypatch.setenv("PQC_PUBLIC_KEY", b64(pk))
    mod.assert_ready()
    r = mod.sign_receipt("i-1", "0xabc", 0.05, "tx-1")
    assert "." in r
    assert mod.verify_receipt(r)["valid"] is True


def test_flag_par_que_nao_casa_recusa(monkeypatch):
    _, sk = ML.keygen()
    other_pk, _ = ML.keygen()
    monkeypatch.setenv("PQC_REQUIRE_PERSISTENT_KEY", "true")
    monkeypatch.setenv("PQC_SECRET_KEY", b64(sk))
    monkeypatch.setenv("PQC_PUBLIC_KEY", b64(other_pk))
    with pytest.raises(RuntimeError, match="não corresponde"):
        mod.assert_ready()


def test_sem_flag_continua_efemero_para_dev():
    mod.assert_ready()  # no-op
    assert "." in mod.sign_receipt("i-2", "0xabc", 1.0, "tx-2")
