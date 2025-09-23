#!/bin/bash

# SubCaster Build Script
# Builds both web and desktop versions

set -e

echo "🚀 SubCaster Build Script"
echo "========================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if npm is available
if ! command -v npm &> /dev/null; then
    print_error "npm is not installed. Please install Node.js and npm first."
    exit 1
fi

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    print_status "Installing dependencies..."
    npm install
    print_success "Dependencies installed"
fi

# Build target (default: all)
BUILD_TARGET=${1:-all}

case $BUILD_TARGET in
    web)
        print_status "Building Web-App..."
        npm run build:web
        print_success "Web-App built successfully!"
        print_status "Output: dist/"
        ;;
    desktop)
        print_status "Building Desktop-App..."
        npm run build:desktop
        print_success "Desktop-App built successfully!"
        print_status "Output: dist-electron/"
        ;;
    win)
        print_status "Building Desktop-App for Windows..."
        npm run build:desktop:win
        print_success "Windows Desktop-App built successfully!"
        ;;
    mac)
        print_status "Building Desktop-App for macOS..."
        npm run build:desktop:mac
        print_success "macOS Desktop-App built successfully!"
        ;;
    linux)
        print_status "Building Desktop-App for Linux..."
        npm run build:desktop:linux
        print_success "Linux Desktop-App built successfully!"
        ;;
    all)
        print_status "Building Web-App..."
        npm run build:web
        print_success "Web-App built successfully!"
        
        print_status "Building Desktop-App..."
        npm run build:desktop
        print_success "Desktop-App built successfully!"
        
        print_success "All builds completed!"
        print_status "Web output: dist/"
        print_status "Desktop output: dist-electron/"
        ;;
    dev)
        print_status "Starting development mode..."
        print_warning "This will start both web dev server and Electron"
        npm run electron:dev
        ;;
    clean)
        print_status "Cleaning build outputs..."
        rm -rf dist dist-electron
        print_success "Build outputs cleaned"
        ;;
    *)
        echo "Usage: $0 [web|desktop|win|mac|linux|all|dev|clean]"
        echo ""
        echo "Options:"
        echo "  web      - Build web app only"
        echo "  desktop  - Build desktop app for current platform"
        echo "  win      - Build desktop app for Windows"
        echo "  mac      - Build desktop app for macOS"
        echo "  linux    - Build desktop app for Linux"
        echo "  all      - Build both web and desktop apps (default)"
        echo "  dev      - Start development mode"
        echo "  clean    - Clean build outputs"
        exit 1
        ;;
esac

echo ""
print_success "Build process completed!"

# Show build info
if [ -d "dist" ]; then
    WEB_SIZE=$(du -sh dist 2>/dev/null | cut -f1 || echo "unknown")
    print_status "Web build size: $WEB_SIZE"
fi

if [ -d "dist-electron" ]; then
    DESKTOP_SIZE=$(du -sh dist-electron 2>/dev/null | cut -f1 || echo "unknown")
    print_status "Desktop build size: $DESKTOP_SIZE"
fi