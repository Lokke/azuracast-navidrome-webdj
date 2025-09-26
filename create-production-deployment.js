#!/usr/bin/env node

/**
 * SubCaster Production Deployment Packager
 * Creates a clean production deployment with only necessary files
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const CONFIG = {
  sourceDir: __dirname,
  productionDir: path.join(__dirname, 'production'),
  buildFirst: true,
  verbose: true
};

// Files and directories to include in production
const PRODUCTION_FILES = {
  // Core application files
  core: [
    'package.json',
    'package-lock.json',
    'unified-server.js',
    'tsconfig.json',  // Needed for runtime TypeScript compilation if any
    '.env.example'    // Template for production setup
  ],
  
  // Built distribution
  dist: [
    'dist/**/*'
  ],
  
  // Public assets
  public: [
    'public/**/*'
  ],
  
  // Production scripts
  scripts: [
    'start-production.js',
    'stop-production.js'
  ],
  
  // Documentation
  docs: [
    'README.md',
    'PRODUCTION.md',
    'LICENSE.md'
  ],
  
  // Configuration templates
  config: [
    '.env.example'
  ]
};

// Files and directories to exclude (never copy)
const EXCLUDE_PATTERNS = [
  'node_modules/**/*',
  '.git/**/*',
  '.vscode/**/*',
  'src/**/*',        // Source files not needed in production
  'electron/**/*',   // Desktop app files
  'config/**/*',     // Development configs
  'dist-electron/**/*',
  '.env',           // Don't copy actual env file (secrets!)
  '.env.docker*',
  'build.*',
  'docker*',
  'DOCKER.md',
  'BUILD.md',
  '*.log',
  '*.pid',
  'start-production-fixed.ps1',
  'start-production.ps1',  // PowerShell version has issues
  'IMAGE_CACHE_SUMMARY.md'
];

// Logging
function log(message, level = 'INFO') {
  const timestamp = new Date().toISOString();
  const prefix = CONFIG.verbose ? `[${timestamp}] [${level}] ` : '';
  console.log(`${prefix}${message}`);
}

// Check if pattern matches path
function matchesPattern(filePath, pattern) {
  if (pattern.includes('**')) {
    // Glob pattern with wildcards
    const regexPattern = pattern
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/\\\\]*')
      .replace(/\//g, '[/\\\\]');
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(filePath);
  } else {
    // Simple pattern
    return filePath === pattern || filePath.endsWith(pattern);
  }
}

// Check if file should be excluded
function shouldExclude(filePath) {
  const relativePath = path.relative(CONFIG.sourceDir, filePath);
  return EXCLUDE_PATTERNS.some(pattern => matchesPattern(relativePath, pattern));
}

// Copy file with directory creation
function copyFile(src, dest) {
  const destDir = path.dirname(dest);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }
  
  try {
    fs.copyFileSync(src, dest);
    if (CONFIG.verbose) {
      log(`Copied: ${path.relative(CONFIG.sourceDir, src)}`);
    }
    return true;
  } catch (error) {
    log(`Error copying ${src}: ${error.message}`, 'ERROR');
    return false;
  }
}

// Copy directory recursively
function copyDirectory(src, dest) {
  if (!fs.existsSync(src)) {
    log(`Source directory does not exist: ${src}`, 'WARN');
    return 0;
  }
  
  let copiedCount = 0;
  const items = fs.readdirSync(src);
  
  for (const item of items) {
    const srcPath = path.join(src, item);
    const destPath = path.join(dest, item);
    
    if (shouldExclude(srcPath)) {
      if (CONFIG.verbose) {
        log(`Excluded: ${path.relative(CONFIG.sourceDir, srcPath)}`);
      }
      continue;
    }
    
    const stat = fs.statSync(srcPath);
    
    if (stat.isDirectory()) {
      copiedCount += copyDirectory(srcPath, destPath);
    } else {
      if (copyFile(srcPath, destPath)) {
        copiedCount++;
      }
    }
  }
  
  return copiedCount;
}

// Build application first
async function buildApplication() {
  if (!CONFIG.buildFirst) return true;
  
  log('🔨 Building application for production...');
  
  return new Promise((resolve, reject) => {
    const buildProcess = spawn('npm', ['run', 'build'], {
      stdio: 'pipe',
      shell: true,
      cwd: CONFIG.sourceDir
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
        resolve(true);
      } else {
        log(`❌ Build failed with code ${code}`, 'ERROR');
        log(`Build error: ${buildError}`, 'ERROR');
        reject(new Error(`Build failed with code ${code}`));
      }
    });
  });
}

// Create production package.json with only production dependencies
function createProductionPackageJson() {
  const srcPackageJson = path.join(CONFIG.sourceDir, 'package.json');
  const destPackageJson = path.join(CONFIG.productionDir, 'package.json');
  
  if (!fs.existsSync(srcPackageJson)) {
    log('No package.json found', 'WARN');
    return;
  }
  
  const packageData = JSON.parse(fs.readFileSync(srcPackageJson, 'utf8'));
  
  // Create production-optimized package.json
  const productionPackage = {
    name: packageData.name,
    version: packageData.version,
    description: packageData.description,
    author: packageData.author,
    license: packageData.license,
    type: packageData.type,
    
    // Only production scripts
    scripts: {
      start: "node start-production.js",
      stop: "node stop-production.js",
      "start:server": "node unified-server.js"
    },
    
    // Only production dependencies
    dependencies: packageData.dependencies || {},
    
    // Add production-specific settings
    engines: packageData.engines || {
      node: ">=18.0.0"
    }
  };
  
  fs.writeFileSync(destPackageJson, JSON.stringify(productionPackage, null, 2));
  log('✅ Created production package.json');
}

// Create production environment template
function createProductionEnvTemplate() {
  const envTemplate = `# SubCaster Production Configuration
# Copy this file to .env and fill in your values

# OpenSubsonic API Configuration (for music library)
VITE_OPENSUBSONIC_URL=https://your-music-server.com
VITE_OPENSUBSONIC_USERNAME=your-username
VITE_OPENSUBSONIC_PASSWORD=your-password

# Proxy Server Configuration
PROXY_PORT=3001

# AzuraCast WebDJ Integration (optional)
VITE_AZURACAST_SERVERS=https://your-radio-server.com
VITE_AZURACAST_STATION_ID=1
VITE_AZURACAST_DJ_USERNAME=your-dj-username
VITE_AZURACAST_DJ_PASSWORD=your-dj-password

# Live Streaming Configuration
VITE_STREAM_BITRATE=128
VITE_STREAM_SAMPLE_RATE=44100

# Production Environment
NODE_ENV=production
PORT=3001
`;
  
  const envTemplatePath = path.join(CONFIG.productionDir, '.env.production.example');
  fs.writeFileSync(envTemplatePath, envTemplate);
  log('✅ Created production environment template');
}

// Create deployment readme
function createDeploymentReadme() {
  const deploymentReadme = `# SubCaster Production Deployment

This directory contains a production-ready deployment of SubCaster.

## 🚀 Quick Start

### 1. Install Dependencies
\`\`\`bash
npm install --production
\`\`\`

### 2. Configure Environment
\`\`\`bash
cp .env.production.example .env
# Edit .env with your actual values
\`\`\`

### 3. Start Production Server
\`\`\`bash
npm start
# or
node start-production.js
\`\`\`

### 4. Stop Server
\`\`\`bash
npm stop
# or
node stop-production.js
\`\`\`

## 📁 Directory Structure

\`\`\`
production/
├── dist/              # Built web application
├── public/            # Static assets
├── start-production.js # Production starter with auto-restart
├── stop-production.js  # Production stopper
├── unified-server.js   # Main server file
├── package.json       # Production dependencies only
├── .env.production.example # Environment template
└── README.md          # This file
\`\`\`

## 🔧 Configuration

Edit \`.env\` file with your settings:
- **VITE_OPENSUBSONIC_URL**: Your music server URL
- **PROXY_PORT**: Server port (default: 3001)
- **NODE_ENV**: Should be 'production'

## 📊 Monitoring

- **Logs**: Check \`production.log\` for all server events
- **PID**: Server process ID stored in \`subcaster.pid\`
- **Status**: Use \`ps aux | grep node\` to check if running

## 🛠️ Troubleshooting

### Server won't start
1. Check \`production.log\` for errors
2. Verify \`.env\` configuration
3. Ensure port is available

### Build issues
This deployment contains pre-built files. If you need to rebuild:
\`\`\`bash
# You'll need the full source code for rebuilding
npm run build
\`\`\`

## 🔐 Security Notes

- Never commit \`.env\` files with real credentials
- Run server as non-root user in production
- Use reverse proxy (nginx) for SSL/HTTPS
- Configure firewall for your specific port

## 📞 Support

For issues and documentation, see the main repository.
`;
  
  const readmePath = path.join(CONFIG.productionDir, 'README.md');
  fs.writeFileSync(readmePath, deploymentReadme);
  log('✅ Created deployment README');
}

// Main deployment function
async function createProductionDeployment() {
  try {
    log('🎯 SubCaster Production Deployment Packager');
    log('===========================================');
    
    // Clean existing production directory
    if (fs.existsSync(CONFIG.productionDir)) {
      log('🧹 Cleaning existing production directory...');
      fs.rmSync(CONFIG.productionDir, { recursive: true, force: true });
    }
    
    // Create production directory
    fs.mkdirSync(CONFIG.productionDir, { recursive: true });
    log(`📁 Created production directory: ${CONFIG.productionDir}`);
    
    // Build application first
    await buildApplication();
    
    let totalFiles = 0;
    
    // Copy core files
    log('📋 Copying core application files...');
    for (const file of PRODUCTION_FILES.core) {
      const srcPath = path.join(CONFIG.sourceDir, file);
      const destPath = path.join(CONFIG.productionDir, file);
      
      if (fs.existsSync(srcPath) && !shouldExclude(srcPath)) {
        if (copyFile(srcPath, destPath)) {
          totalFiles++;
        }
      }
    }
    
    // Copy production scripts
    log('🔧 Copying production scripts...');
    for (const script of PRODUCTION_FILES.scripts) {
      const srcPath = path.join(CONFIG.sourceDir, script);
      const destPath = path.join(CONFIG.productionDir, script);
      
      if (fs.existsSync(srcPath)) {
        if (copyFile(srcPath, destPath)) {
          totalFiles++;
        }
      }
    }
    
    // Copy built distribution
    log('🏗️ Copying built application...');
    const distSrc = path.join(CONFIG.sourceDir, 'dist');
    const distDest = path.join(CONFIG.productionDir, 'dist');
    totalFiles += copyDirectory(distSrc, distDest);
    
    // Copy public assets
    log('🖼️ Copying public assets...');
    const publicSrc = path.join(CONFIG.sourceDir, 'public');
    const publicDest = path.join(CONFIG.productionDir, 'public');
    totalFiles += copyDirectory(publicSrc, publicDest);
    
    // Copy documentation
    log('📚 Copying documentation...');
    for (const doc of PRODUCTION_FILES.docs) {
      const srcPath = path.join(CONFIG.sourceDir, doc);
      const destPath = path.join(CONFIG.productionDir, doc);
      
      if (fs.existsSync(srcPath)) {
        if (copyFile(srcPath, destPath)) {
          totalFiles++;
        }
      }
    }
    
    // Create optimized production files
    log('⚙️ Creating production-specific files...');
    createProductionPackageJson();
    createProductionEnvTemplate();
    createDeploymentReadme();
    
    // Calculate deployment size
    const deploymentSize = calculateDirectorySize(CONFIG.productionDir);
    
    log('✅ Production deployment created successfully!');
    log('=============================================');
    log(`📁 Location: ${CONFIG.productionDir}`);
    log(`📄 Files copied: ${totalFiles}`);
    log(`💾 Deployment size: ${formatBytes(deploymentSize)}`);
    log('');
    log('🚀 Next steps:');
    log('1. cd production');
    log('2. npm install --production');
    log('3. cp .env.production.example .env');
    log('4. Edit .env with your configuration');
    log('5. npm start');
    
  } catch (error) {
    log(`❌ Deployment failed: ${error.message}`, 'ERROR');
    process.exit(1);
  }
}

// Calculate directory size
function calculateDirectorySize(dirPath) {
  let totalSize = 0;
  
  function addSize(itemPath) {
    const stats = fs.statSync(itemPath);
    if (stats.isDirectory()) {
      const items = fs.readdirSync(itemPath);
      for (const item of items) {
        addSize(path.join(itemPath, item));
      }
    } else {
      totalSize += stats.size;
    }
  }
  
  try {
    addSize(dirPath);
  } catch (error) {
    log(`Error calculating size: ${error.message}`, 'WARN');
  }
  
  return totalSize;
}

// Format bytes to human readable
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Run deployment
createProductionDeployment();