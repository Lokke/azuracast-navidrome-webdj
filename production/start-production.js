#!/usr/bin/env node

/**
 * SubCaster Production Starter
 * Builds the application and starts it in production mode with auto-restart on crash
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const CONFIG = {
  maxRestarts: 10,
  restartDelay: 5000, // 5 seconds
  buildTimeout: 300000, // 5 minutes
  logFile: path.join(__dirname, 'production.log'),
  pidFile: path.join(__dirname, 'subcaster.pid'),
  port: process.env.PORT || 3001
};

let restartCount = 0;
let serverProcess = null;
let isShuttingDown = false;

// Logging function
function log(message, level = 'INFO') {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level}] ${message}\n`;
  
  console.log(logMessage.trim());
  
  // Write to log file
  fs.appendFileSync(CONFIG.logFile, logMessage);
}

// Build the application
async function buildApplication() {
  log('🔨 Building application for production...');
  
  return new Promise((resolve, reject) => {
    const buildProcess = spawn('npm', ['run', 'build'], {
      stdio: 'pipe',
      shell: true,
      cwd: __dirname
    });
    
    let buildOutput = '';
    let buildError = '';
    
    buildProcess.stdout.on('data', (data) => {
      buildOutput += data.toString();
    });
    
    buildProcess.stderr.on('data', (data) => {
      buildError += data.toString();
    });
    
    buildProcess.on('close', (code) => {
      if (code === 0) {
        log('✅ Build completed successfully');
        log(`Build output: ${buildOutput}`);
        resolve();
      } else {
        log(`❌ Build failed with code ${code}`, 'ERROR');
        log(`Build error: ${buildError}`, 'ERROR');
        reject(new Error(`Build failed with code ${code}`));
      }
    });
    
    // Timeout for build process
    setTimeout(() => {
      buildProcess.kill('SIGTERM');
      reject(new Error('Build timeout'));
    }, CONFIG.buildTimeout);
  });
}

// Start the server
function startServer() {
  if (isShuttingDown) return;
  
  log(`🚀 Starting SubCaster server (attempt ${restartCount + 1}/${CONFIG.maxRestarts})...`);
  
  // Start the unified server
  serverProcess = spawn('node', ['unified-server.js'], {
    stdio: 'pipe',
    shell: true,
    cwd: __dirname,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: CONFIG.port
    }
  });
  
  // Write PID file
  fs.writeFileSync(CONFIG.pidFile, serverProcess.pid.toString());
  
  serverProcess.stdout.on('data', (data) => {
    log(`Server: ${data.toString().trim()}`);
  });
  
  serverProcess.stderr.on('data', (data) => {
    log(`Server Error: ${data.toString().trim()}`, 'ERROR');
  });
  
  serverProcess.on('close', (code, signal) => {
    log(`Server process exited with code ${code} and signal ${signal}`);
    
    // Clean up PID file
    if (fs.existsSync(CONFIG.pidFile)) {
      fs.unlinkSync(CONFIG.pidFile);
    }
    
    if (isShuttingDown) {
      log('Server shutdown completed');
      return;
    }
    
    if (code !== 0 && restartCount < CONFIG.maxRestarts) {
      restartCount++;
      log(`💥 Server crashed! Restarting in ${CONFIG.restartDelay/1000} seconds... (${restartCount}/${CONFIG.maxRestarts})`, 'WARN');
      
      setTimeout(() => {
        startServer();
      }, CONFIG.restartDelay);
    } else if (restartCount >= CONFIG.maxRestarts) {
      log(`❌ Maximum restart attempts (${CONFIG.maxRestarts}) reached. Giving up.`, 'ERROR');
      process.exit(1);
    }
  });
  
  serverProcess.on('error', (error) => {
    log(`Server process error: ${error.message}`, 'ERROR');
  });
}

// Graceful shutdown
function gracefulShutdown(signal) {
  log(`📴 Received ${signal}. Shutting down gracefully...`);
  isShuttingDown = true;
  
  if (serverProcess) {
    log('Terminating server process...');
    serverProcess.kill('SIGTERM');
    
    // Force kill after 10 seconds
    setTimeout(() => {
      if (serverProcess && !serverProcess.killed) {
        log('Force killing server process...', 'WARN');
        serverProcess.kill('SIGKILL');
      }
    }, 10000);
  }
  
  // Clean up PID file
  if (fs.existsSync(CONFIG.pidFile)) {
    fs.unlinkSync(CONFIG.pidFile);
  }
  
  setTimeout(() => {
    log('Shutdown complete');
    process.exit(0);
  }, 2000);
}

// Check if server is already running
function checkExistingProcess() {
  if (fs.existsSync(CONFIG.pidFile)) {
    const pid = parseInt(fs.readFileSync(CONFIG.pidFile, 'utf8'));
    
    try {
      process.kill(pid, 0); // Check if process exists
      log(`❌ Server already running with PID ${pid}`, 'ERROR');
      log('Use "npm run stop:production" to stop the existing server');
      process.exit(1);
    } catch (error) {
      // Process doesn't exist, remove stale PID file
      fs.unlinkSync(CONFIG.pidFile);
    }
  }
}

// Display server info
function displayInfo() {
  log('🎵 SubCaster Production Server');
  log('===============================');
  log(`Port: ${CONFIG.port}`);
  log(`Max Restarts: ${CONFIG.maxRestarts}`);
  log(`Restart Delay: ${CONFIG.restartDelay}ms`);
  log(`Log File: ${CONFIG.logFile}`);
  log(`PID File: ${CONFIG.pidFile}`);
  log('===============================');
}

// Main execution
async function main() {
  try {
    displayInfo();
    checkExistingProcess();
    
    // Set up signal handlers
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGHUP', () => gracefulShutdown('SIGHUP'));
    
    // Build first
    await buildApplication();
    
    // Start server
    startServer();
    
    log('✅ SubCaster production server started successfully');
    log(`🌐 Server will be available at http://localhost:${CONFIG.port}`);
    log('📝 Press Ctrl+C to stop the server');
    
  } catch (error) {
    log(`❌ Failed to start production server: ${error.message}`, 'ERROR');
    process.exit(1);
  }
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  log(`Uncaught Exception: ${error.message}`, 'ERROR');
  log(error.stack, 'ERROR');
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
  log(`Unhandled Rejection at: ${promise}, reason: ${reason}`, 'ERROR');
});

main();