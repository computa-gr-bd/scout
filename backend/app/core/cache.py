"""Cache em memória com TTL (time-to-live) para endpoints de leitura frequente.

Usado para reduzir tráfego de rede e carga no banco consultando dados que
mudam pouco (tabela de liga, lista de ligas, estatísticas agregadas, escudos).

Não requer dependências externas: implementado com dict + time.monotonic.
"""

from __future__ import annotations

import time
import threading
from typing import Any, Callable, Dict, Optional, Tuple


class TTLCache:
    """Cache thread-safe com expiração por tempo."""

    def __init__(self, default_ttl: float = 300.0, max_items: int = 1024):
        self._default_ttl = default_ttl
        self._max_items = max_items
        self._store: Dict[str, Tuple[float, Any]] = {}
        self._lock = threading.RLock()

    def get(self, key: str) -> Optional[Any]:
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            expiry, value = entry
            if time.monotonic() > expiry:
                del self._store[key]
                return None
            return value

    def set(self, key: str, value: Any, ttl: Optional[float] = None) -> None:
        ttl = ttl if ttl is not None else self._default_ttl
        expiry = time.monotonic() + ttl
        with self._lock:
            # Evita crescer indefinidamente: remove o mais antigo se cheio.
            if len(self._store) >= self._max_items and key not in self._store:
                oldest_key = min(self._store, key=lambda k: self._store[k][0])
                del self._store[oldest_key]
            self._store[key] = (expiry, value)

    def delete(self, key: str) -> None:
        with self._lock:
            self._store.pop(key, None)

    def clear(self) -> None:
        with self._lock:
            self._store.clear()


# Instância global (singleton) usada pelos endpoints.
cache = TTLCache(default_ttl=300.0, max_items=2048)


def cached(ttl: float = 300.0, key_prefix: str = "") -> Callable:
    """Decorador para cachear resultados de funções síncronas por TTL.

    A chave do cache é construída a partir do prefixo + argumentos posicionais
    e nomeados (repr). Ideal para endpoints FastAPI que leem do banco.
    """

    def decorator(func: Callable) -> Callable:
        def wrapper(*args, **kwargs):
            # Monta chave determinística a partir dos argumentos.
            key_parts = [key_prefix or func.__name__]
            for a in args:
                key_parts.append(repr(a))
            for k in sorted(kwargs):
                key_parts.append(f"{k}={repr(kwargs[k])}")
            cache_key = "|".join(key_parts)

            cached_value = cache.get(cache_key)
            if cached_value is not None:
                return cached_value

            result = func(*args, **kwargs)
            cache.set(cache_key, result, ttl=ttl)
            return result

        return wrapper

    return decorator


def invalidate(key: str) -> None:
    """Remove uma chave específica do cache."""
    cache.delete(key)


def invalidate_prefix(prefix: str) -> None:
    """Remove todas as chaves que começam com o prefixo dado."""
    with cache._lock:
        for k in list(cache._store.keys()):
            if k.startswith(prefix):
                del cache._store[k]
