#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Auto-run stop.sh first (it will print its own messages)
./stop.sh
echo ""

# Start backend
echo -e "${GREEN}🚀 Starting backend...${NC}"
cd backend
python3 main.py > ../backend.log 2>&1 &
BACKEND_PID=$!
echo -e "${GREEN}Backend started with PID: ${BACKEND_PID}${NC}"
echo -e "${YELLOW}Backend logs: tail -f backend.log${NC}"
cd ..

# Wait a bit for backend to start
sleep 3

# Start frontend
echo -e "${GREEN}🚀 Starting frontend...${NC}"
cd frontend
npm run dev > ../frontend.log 2>&1 &
FRONTEND_PID=$!
echo -e "${GREEN}Frontend started with PID: ${FRONTEND_PID}${NC}"
echo -e "${YELLOW}Frontend logs: tail -f frontend.log${NC}"
cd ..

echo ""
echo -e "${GREEN}✅ Both services started!${NC}"
echo ""
echo -e "${YELLOW}Backend PID: ${BACKEND_PID}${NC}"
echo -e "${YELLOW}Frontend PID: ${FRONTEND_PID}${NC}"
echo ""
echo -e "${GREEN}To view logs:${NC}"
echo -e "  Backend:  ${YELLOW}tail -f backend.log${NC}"
echo -e "  Frontend: ${YELLOW}tail -f frontend.log${NC}"
echo ""
echo -e "${GREEN}To stop all processes:${NC}"
echo -e "  ${YELLOW}./stop.sh${NC} or ${YELLOW}pkill -f 'python.*main.py|next dev'${NC}"

