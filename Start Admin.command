#!/bin/bash
# Double-click this file on a Mac to start the Steak by Dabbah admin panel.
cd "$(dirname "$0")"
# Open the browser only once *this* server answers. 127.0.0.1 (not "localhost", which can reach another app on ::1).
(
  for _ in $(seq 1 40); do
    if curl -s "http://127.0.0.1:8080/api/admin/status" | grep -q setupRequired; then
      open "http://127.0.0.1:8080/admin/"
      exit 0
    fi
    sleep 0.25
  done
) &
python3 server.py --port 8080
