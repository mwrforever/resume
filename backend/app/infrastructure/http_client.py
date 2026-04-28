import httpx

from app.config.constants import DEFAULT_HTTP_CONNECT_TIMEOUT, DEFAULT_HTTP_READ_TIMEOUT, MAX_HTTP_RESPONSE_BYTES


class HttpClient:
    instance_strategy = "Singleton"

    def __init__(self) -> None:
        timeout = httpx.Timeout(DEFAULT_HTTP_READ_TIMEOUT, connect=DEFAULT_HTTP_CONNECT_TIMEOUT)
        self._client = httpx.AsyncClient(timeout=timeout)

    async def get_json(self, url: str) -> dict:
        response = await self._client.get(url)
        content_length = int(response.headers.get("content-length") or 0)
        if content_length > MAX_HTTP_RESPONSE_BYTES:
            raise ValueError("Response body is too large")
        response.raise_for_status()
        data = response.json()
        if not isinstance(data, dict):
            raise ValueError("Response body must be a JSON object")
        return data

    async def close(self) -> None:
        await self._client.aclose()
