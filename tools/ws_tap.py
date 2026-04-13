#!/usr/bin/env python3
import argparse
import asyncio
import json
from datetime import datetime

import websockets


def ts():
    return datetime.now().strftime("%H:%M:%S")


def pretty_text(message):
    if isinstance(message, bytes):
        return f"<{len(message)} bytes binary>"
    text = str(message)
    try:
        return json.dumps(json.loads(text), ensure_ascii=False, indent=2)
    except Exception:
        return text


async def pipe_client_to_server(client_ws, server_ws):
    async for message in client_ws:
        print(f"\n[{ts()}] client -> printer")
        print(pretty_text(message), flush=True)
        await server_ws.send(message)


async def pipe_server_to_client(server_ws, client_ws):
    async for message in server_ws:
        print(f"\n[{ts()}] printer -> client")
        print(pretty_text(message), flush=True)
        await client_ws.send(message)


async def handle_client(client_ws, path, upstream_url):
    print(f"[{ts()}] connected client on {path}", flush=True)
    async with websockets.connect(upstream_url, max_size=None) as server_ws:
        await asyncio.gather(
            pipe_client_to_server(client_ws, server_ws),
            pipe_server_to_client(server_ws, client_ws),
        )


async def main():
    parser = argparse.ArgumentParser(description="Tap WebSocket traffic between the panel and the printer.")
    parser.add_argument("--listen-host", default="127.0.0.1")
    parser.add_argument("--listen-port", type=int, default=9998)
    parser.add_argument("--printer-host", required=True)
    parser.add_argument("--printer-port", type=int, default=9999)
    args = parser.parse_args()

    upstream_url = f"ws://{args.printer_host}:{args.printer_port}"
    print(f"[{ts()}] listening on ws://{args.listen_host}:{args.listen_port}", flush=True)
    print(f"[{ts()}] forwarding to {upstream_url}", flush=True)

    async def handler(client_ws, path):
        await handle_client(client_ws, path, upstream_url)

    async with websockets.serve(handler, args.listen_host, args.listen_port, max_size=None):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
