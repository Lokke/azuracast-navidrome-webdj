#!/usr/bin/env node

/**
 * SubCaster Production Stopper
 * Stops the running production server gracefully
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG = {
  pidFile: path.join(__dirname, 'subcaster.pid'),
  logFile: path.join(__dirname, 'production.log')
};

function log(message, level = 'INFO') {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level}] ${message}`;
  
  console.log(logMessage);
  
  // Write to log file if it exists
  if (fs.existsSync(CONFIG.logFile)) {
    fs.appendFileSync(CONFIG.logFile, logMessage + '\n');
  }
}

function stopServer() {
  if (!fs.existsSync(CONFIG.pidFile)) {
    log('❌ No running server found (PID file not found)', 'ERROR');
    log('Server may not be running or was started manually');
    process.exit(1);
  }
  
  try {
    const pid = parseInt(fs.readFileSync(CONFIG.pidFile, 'utf8'));
    log(`📴 Stopping SubCaster server (PID: ${pid})...`);
    
    // Check if process exists
    try {
      process.kill(pid, 0);
    } catch (error) {
      log('❌ Process not found, cleaning up PID file', 'WARN');
      fs.unlinkSync(CONFIG.pidFile);
      process.exit(1);
    }
    
    // Send SIGTERM for graceful shutdown
    process.kill(pid, 'SIGTERM');
    log('✅ SIGTERM sent to server process');
    
    // Wait for process to exit
    let attempts = 0;
    const maxAttempts = 30; // 30 seconds
    
    const checkProcess = setInterval(() => {
      attempts++;
      
      try {
        process.kill(pid, 0);
        
        if (attempts >= maxAttempts) {
          log('⚠️  Process still running after 30 seconds, force killing...', 'WARN');
          process.kill(pid, 'SIGKILL');
          clearInterval(checkProcess);
          
          setTimeout(() => {
            if (fs.existsSync(CONFIG.pidFile)) {
              fs.unlinkSync(CONFIG.pidFile);
            }
            log('✅ Server force stopped');
            process.exit(0);
          }, 2000);
        }
      } catch (error) {
        // Process has exited
        clearInterval(checkProcess);
        
        if (fs.existsSync(CONFIG.pidFile)) {
          fs.unlinkSync(CONFIG.pidFile);
        }
        
        log('✅ Server stopped successfully');
        process.exit(0);
      }
    }, 1000);
    
  } catch (error) {
    log(`❌ Error stopping server: ${error.message}`, 'ERROR');
    process.exit(1);
  }
}

log('🛑 SubCaster Production Stopper');
stopServer();