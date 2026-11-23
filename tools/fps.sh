#!/bin/sh
# tools/fps.sh PORT shots.json OUTPREFIX : same as shoot.mjs --fps, holding the shared GPU lock so timings from
# parallel agents don't disturb each other (all worktrees use /home/zp/workspace/lauv-aquarium/.gpu.lock).
DIR=$(dirname "$0")
exec flock /home/zp/workspace/lauv-aquarium/.gpu.lock env HEADLESS=1 node "$DIR/shoot.mjs" "$1" "$2" "$3" --fps
