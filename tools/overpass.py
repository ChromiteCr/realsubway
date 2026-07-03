"""Overpass API 查询,多镜像重试。"""

import time

import requests

ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
]


def query(ql: str, tries_per_endpoint: int = 2) -> dict:
    last_err: Exception | None = None
    for endpoint in ENDPOINTS:
        for attempt in range(tries_per_endpoint):
            try:
                resp = requests.post(
                    endpoint,
                    data={"data": ql},
                    timeout=240,
                    # overpass-api.de 会 406 拒绝默认的 python-requests UA
                    headers={"User-Agent": "realsubway-pipeline/0.1"},
                )
                resp.raise_for_status()
                return resp.json()
            except Exception as e:  # noqa: BLE001 - 网络层什么都可能抛
                last_err = e
                wait = 5 * (attempt + 1)
                print(f"  {endpoint} 失败({e}),{wait}s 后重试")
                time.sleep(wait)
    raise SystemExit(f"所有 Overpass 镜像均失败: {last_err}")
