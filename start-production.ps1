# SubCaster Production Starter (PowerShell)
# Builds the application and starts it in production mode with auto-restart on crash

param(
    [int]$MaxRestarts = 10,
    [int]$RestartDelay = 5000,
    [int]$Port = 3001
)

# Configuration
$Config = @{
    MaxRestarts = $MaxRestarts
    RestartDelay = $RestartDelay
    BuildTimeout = 300000  # 5 minutes
    LogFile = Join-Path $PSScriptRoot "production.log"
    PidFile = Join-Path $PSScriptRoot "subcaster.pid"
    Port = if ($env:PORT) { $env:PORT } else { $Port }
}

$RestartCount = 0
$ServerProcess = $null
$IsShuttingDown = $false

# Logging function
function Write-Log {
    param(
        [string]$Message,
        [string]$Level = "INFO"
    )
    
    $Timestamp = Get-Date -Format "yyyy-MM-ddTHH:mm:ss.fffZ"
    $LogMessage = "[$Timestamp] [$Level] $Message"
    
    Write-Host $LogMessage
    Add-Content -Path $Config.LogFile -Value $LogMessage
}

# Build the application
function Build-Application {
    Write-Log "🔨 Building application for production..."
    
    try {
        $BuildProcess = Start-Process -FilePath "npm" -ArgumentList "run", "build" -WorkingDirectory $PSScriptRoot -Wait -PassThru -NoNewWindow -RedirectStandardOutput "build.log" -RedirectStandardError "build-error.log"
        
        if ($BuildProcess.ExitCode -eq 0) {
            Write-Log "✅ Build completed successfully"
            $BuildOutput = Get-Content "build.log" -Raw
            Write-Log "Build output: $BuildOutput"
            Remove-Item "build.log", "build-error.log" -ErrorAction SilentlyContinue
            return $true
        } else {
            $BuildError = Get-Content "build-error.log" -Raw
            Write-Log "❌ Build failed with code $($BuildProcess.ExitCode)" "ERROR"
            Write-Log "Build error: $BuildError" "ERROR"
            Remove-Item "build.log", "build-error.log" -ErrorAction SilentlyContinue
            return $false
        }
    } catch {
        Write-Log "❌ Build failed with exception: $($_.Exception.Message)" "ERROR"
        return $false
    }
}

# Start the server
function Start-Server {
    if ($IsShuttingDown) { return }
    
    Write-Log "🚀 Starting SubCaster server (attempt $($RestartCount + 1)/$($Config.MaxRestarts))..."
    
    try {
        # Set environment variables
        $env:NODE_ENV = "production"
        $env:PORT = $Config.Port
        
        # Start the unified server
        $ServerProcess = Start-Process -FilePath "node" -ArgumentList "unified-server.js" -WorkingDirectory $PSScriptRoot -PassThru -NoNewWindow
        
        # Write PID file
        $ServerProcess.Id | Out-File -FilePath $Config.PidFile -Encoding utf8
        
        Write-Log "✅ Server started with PID $($ServerProcess.Id)"
        Write-Log "🌐 Server available at http://localhost:$($Config.Port)"
        
        # Monitor the process
        while (-not $ServerProcess.HasExited -and -not $IsShuttingDown) {
            Start-Sleep -Seconds 1
        }
        
        # Clean up PID file
        if (Test-Path $Config.PidFile) {
            Remove-Item $Config.PidFile -Force
        }
        
        if ($IsShuttingDown) {
            Write-Log "Server shutdown completed"
            return
        }
        
        Write-Log "Server process exited with code $($ServerProcess.ExitCode)"
        
        if ($ServerProcess.ExitCode -ne 0 -and $RestartCount -lt $Config.MaxRestarts) {
            $script:RestartCount++
            Write-Log "💥 Server crashed! Restarting in $($Config.RestartDelay/1000) seconds... ($RestartCount/$($Config.MaxRestarts))" "WARN"
            
            Start-Sleep -Milliseconds $Config.RestartDelay
            Start-Server
        } elseif ($RestartCount -ge $Config.MaxRestarts) {
            Write-Log "❌ Maximum restart attempts ($($Config.MaxRestarts)) reached. Giving up." "ERROR"
            exit 1
        }
        
    } catch {
        Write-Log "Server process error: $($_.Exception.Message)" "ERROR"
        
        if ($RestartCount -lt $Config.MaxRestarts) {
            $script:RestartCount++
            Write-Log "Restarting due to error in $($Config.RestartDelay/1000) seconds..." "WARN"
            Start-Sleep -Milliseconds $Config.RestartDelay
            Start-Server
        }
    }
}

# Graceful shutdown
function Stop-Server {
    param([string]$Signal = "Manual")
    
    Write-Log "📴 Received $Signal. Shutting down gracefully..."
    $script:IsShuttingDown = $true
    
    if ($ServerProcess -and -not $ServerProcess.HasExited) {
        Write-Log "Terminating server process..."
        try {
            $ServerProcess.Kill()
            $ServerProcess.WaitForExit(10000)  # Wait up to 10 seconds
        } catch {
            Write-Log "Error terminating server: $($_.Exception.Message)" "ERROR"
        }
    }
    
    # Clean up PID file
    if (Test-Path $Config.PidFile) {
        Remove-Item $Config.PidFile -Force
    }
    
    Write-Log "Shutdown complete"
    exit 0
}

# Check if server is already running
function Test-ExistingProcess {
    if (Test-Path $Config.PidFile) {
        $Pid = Get-Content $Config.PidFile -Raw
        $Pid = $Pid.Trim()
        
        try {
            $ExistingProcess = Get-Process -Id $Pid -ErrorAction Stop
            Write-Log "❌ Server already running with PID $Pid" "ERROR"
            Write-Log "Use 'Stop-Process -Id $Pid' to stop the existing server"
            exit 1
        } catch {
            # Process doesn't exist, remove stale PID file
            Remove-Item $Config.PidFile -Force
        }
    }
}

# Display server info
function Show-Info {
    Write-Log "🎵 SubCaster Production Server"
    Write-Log "==============================="
    Write-Log "Port: $($Config.Port)"
    Write-Log "Max Restarts: $($Config.MaxRestarts)"
    Write-Log "Restart Delay: $($Config.RestartDelay)ms"
    Write-Log "Log File: $($Config.LogFile)"
    Write-Log "PID File: $($Config.PidFile)"
    Write-Log "==============================="
}

# Set up Ctrl+C handler
$null = [Console]::TreatControlCAsInput = $false
[Console]::CancelKeyPress += {
    param($sender, $e)
    $e.Cancel = $true
    Stop-Server "SIGINT"
}

# Main execution
try {
    Show-Info
    Test-ExistingProcess
    
    # Build first
    if (-not (Build-Application)) {
        Write-Log "❌ Failed to build application" "ERROR"
        exit 1
    }
    
    # Start server
    Start-Server
    
} catch {
    Write-Log "❌ Failed to start production server: $($_.Exception.Message)" "ERROR"
    exit 1
} finally {
    if (Test-Path $Config.PidFile) {
        Remove-Item $Config.PidFile -Force
    }
}