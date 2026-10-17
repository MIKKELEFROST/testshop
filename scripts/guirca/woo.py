"""Small WooCommerce REST client for the importer (requests, retries, paging)."""
from __future__ import annotations

import os
import time

import requests
from requests.adapters import HTTPAdapter


class WooError(Exception):
    def __init__(self, status: int | None, message: str):
        super().__init__(f"{status or 'network'}: {message}")
        self.status = status


class Woo:
    def __init__(self, url: str, key: str, secret: str, timeout: int = 300):
        self.base = url.rstrip("/") + "/wp-json/"
        self.timeout = timeout
        self.session = requests.Session()
        self.session.auth = (key, secret)
        # Room for the importer's parallel workers.
        self.session.mount("https://", HTTPAdapter(pool_connections=8, pool_maxsize=16))
        self.session.mount("http://", HTTPAdapter(pool_connections=8, pool_maxsize=16))
        self.session.headers.update({"User-Agent": "guirca-import/1.0", "Accept": "application/json"})
        # Behind a TLS-inspecting proxy, point REQUESTS_CA_BUNDLE at its CA (requests reads it).

    @classmethod
    def from_env(cls) -> "Woo":
        missing = [k for k in ("WOOCOMMERCE_URL", "WOOCOMMERCE_CONSUMER_KEY", "WOOCOMMERCE_CONSUMER_SECRET") if not os.environ.get(k)]
        if missing:
            raise SystemExit(f"Mangler miljøvariabler: {', '.join(missing)} (se .env.example)")
        return cls(os.environ["WOOCOMMERCE_URL"], os.environ["WOOCOMMERCE_CONSUMER_KEY"], os.environ["WOOCOMMERCE_CONSUMER_SECRET"])

    def request(self, method: str, path: str, *, params=None, body=None, retries: int = 4, safe_to_repeat: bool | None = None):
        """JSON response and headers. Reads are retried; writes only when they never reached WooCommerce.

        A write that timed out may still have been saved, so the caller decides what to do
        (the importer looks the SKUs up again; WooCommerce refuses duplicate SKUs anyway).
        """
        safe = method == "GET" if safe_to_repeat is None else safe_to_repeat
        for attempt in range(retries + 1):
            try:
                response = self.session.request(method, self.base + path, params=params, json=body, timeout=self.timeout)
            except requests.ConnectionError as error:
                # Covers refused connections and resets; a ConnectTimeout never reached the server.
                reached = not isinstance(error, requests.ConnectTimeout)
                failure = WooError(None, str(error)[:300])
                if reached and not safe:
                    raise failure from error
            except requests.Timeout as error:
                failure = WooError(None, f"timeout after {self.timeout} s")
                if not safe:
                    raise failure from error
            else:
                if response.status_code < 500 and response.status_code != 429:
                    try:
                        data = response.json()
                    except ValueError as error:
                        raise WooError(response.status_code, response.text[:300]) from error
                    if response.status_code >= 400:
                        message = data.get("message", "") if isinstance(data, dict) else str(data)[:300]
                        code = data.get("code", "") if isinstance(data, dict) else ""
                        raise WooError(response.status_code, f"{code} {message}".strip())
                    return data, response.headers
                failure = WooError(response.status_code, response.text[:300])
                if not safe and response.status_code != 429:
                    raise failure
            if attempt == retries:
                raise failure
            time.sleep(min(60, 3 * 2**attempt))
        raise AssertionError("unreachable")

    def get(self, path: str, **params):
        return self.request("GET", path, params=params)[0]

    def get_all(self, path: str, **params) -> list:
        """Every page of a collection (100 per page)."""
        items, page = [], 1
        while True:
            data, headers = self.request("GET", path, params={**params, "per_page": 100, "page": page})
            items += data
            if page >= int(headers.get("X-WP-TotalPages") or 1):
                return items
            page += 1

    def post(self, path: str, body: dict, *, safe_to_repeat: bool = False):
        return self.request("POST", path, body=body, safe_to_repeat=safe_to_repeat)[0]

    def put(self, path: str, body: dict):
        return self.request("PUT", path, body=body, safe_to_repeat=True)[0]
