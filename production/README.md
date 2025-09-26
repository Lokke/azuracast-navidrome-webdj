# SubCaster Production Deployment

This directory contains a production-ready deployment of SubCaster.

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install --production
```

### 2. Configure Environment
```bash
cp .env.production.example .env
# Edit .env with your actual values
```

### 3. Start Production Server
```bash
npm start
# or
node start-production.js
```

### 4. Stop Server
```bash
npm stop
# or
node stop-production.js
```

## 📁 Directory Structure

```
production/
├── dist/              # Built web application
├── public/            # Static assets
├── start-production.js # Production starter with auto-restart
├── stop-production.js  # Production stopper
├── unified-server.js   # Main server file
├── package.json       # Production dependencies only
├── .env.production.example # Environment template
└── README.md          # This file
```

## 🔧 Configuration

Edit `.env` file with your settings:
- **VITE_OPENSUBSONIC_URL**: Your music server URL
- **PROXY_PORT**: Server port (default: 3001)
- **NODE_ENV**: Should be 'production'

## 📊 Monitoring

- **Logs**: Check `production.log` for all server events
- **PID**: Server process ID stored in `subcaster.pid`
- **Status**: Use `ps aux | grep node` to check if running

## 🛠️ Troubleshooting

### Server won't start
1. Check `production.log` for errors
2. Verify `.env` configuration
3. Ensure port is available

### Build issues
This deployment contains pre-built files. If you need to rebuild:
```bash
# You'll need the full source code for rebuilding
npm run build
```

## 🔐 Security Notes

- Never commit `.env` files with real credentials
- Run server as non-root user in production
- Use reverse proxy (nginx) for SSL/HTTPS
- Configure firewall for your specific port

## 📞 Support

For issues and documentation, see the main repository.
