#!/bin/bash
set -e

echo "Installing reference solution..."

mkdir -p /app/publisher

cp /solution/publisher/release-publisher.mjs \
   /app/publisher/release-publisher.mjs

echo "Reference solution installed."