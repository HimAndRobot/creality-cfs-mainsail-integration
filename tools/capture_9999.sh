#!/bin/sh
set -eu

DURATION="${1:-5}"
HOST="${2:-192.168.1.242}"
PORT="${3:-9999}"
IFACE="${IFACE:-en0}"

echo "[capture_9999] iface=$IFACE host=$HOST port=$PORT duration=${DURATION}s"
echo "[capture_9999] starting tshark..."

tshark -i "$IFACE" -a "duration:$DURATION" -f "host $HOST and port $PORT" -Y "websocket || tcp" -x
