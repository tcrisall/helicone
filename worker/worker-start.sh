#!/bin/bash

cd /worker
env > .dev.vars

# Start workers in the background
exec npx wrangler dev --var WORKER_TYPE:OPENAI_PROXY --ip 0.0.0.0 --port 8787 -- --inspect=0.0.0.0:9229
