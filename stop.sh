#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}🛑 Stopping all related processes...${NC}"

# Kill backend processes
pkill -f "python.*main.py" 2>/dev/null
pkill -f "uvicorn.*main:app" 2>/dev/null
pkill -f "fastapi" 2>/dev/null

# Kill frontend processes
pkill -f "next dev" 2>/dev/null
pkill -f "next-server" 2>/dev/null
pkill -f "node.*next" 2>/dev/null

# Kill processes on ports
BACKEND_PORT=${BACKEND_PORT:-8000}
FRONTEND_PORT=${FRONTEND_PORT:-3009}
lsof -ti:${BACKEND_PORT} | xargs kill -9 2>/dev/null
lsof -ti:${FRONTEND_PORT} | xargs kill -9 2>/dev/null

sleep 1

echo -e "${GREEN}✅ All processes stopped${NC}"






