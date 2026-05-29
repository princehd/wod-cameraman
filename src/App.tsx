import { useRef } from 'react'
import { useWorkout } from './hooks/useWorkout'
import './App.css'

function App() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const {
    isReady,
    isRunning,
    count,
    squatPhase,
    kneeAngle,
    error,
    loadingMsg,
    facingMode,
    start,
    stop,
    reset,
    switchCamera,
  } = useWorkout(videoRef, canvasRef)

  const statusLabel = isRunning ? 'LIVE' : isReady ? 'READY' : loadingMsg

  return (
    <div className="app">
      <header className="app-header">
        <h1>WOD CAMERAMAN</h1>
        <div className="status-indicator">
          <div
            className={`status-dot ${
              isRunning ? 'running' : isReady ? 'ready' : 'loading'
            }`}
          />
          <span>{statusLabel}</span>
        </div>
      </header>

      <div className="camera-container">
        <video
          ref={videoRef}
          className="camera-video"
          playsInline
          muted
        />
        <canvas ref={canvasRef} className="pose-canvas" />

        {!isRunning && (
          <div className="camera-placeholder">
            <div className="camera-icon">📷</div>
            <span>{isReady ? '시작 버튼을 눌러주세요' : loadingMsg}</span>
          </div>
        )}

        <button
          className="btn-switch-camera"
          onClick={switchCamera}
          disabled={!isReady}
          title={facingMode === 'environment' ? '전면 카메라로 전환' : '후면 카메라로 전환'}
        >
          {facingMode === 'environment' ? '🤳' : '📷'}
        </button>

        {!isReady && (
          <div className="loading-overlay">
            <div className="loading-spinner" />
            <span>{loadingMsg}</span>
          </div>
        )}
      </div>

      <div className="count-section">
        <div className={`squat-phase-badge phase-${squatPhase}`}>
          {squatPhase === 'down' ? 'DOWN ▼' : 'UP ▲'}
        </div>

        <div className="count-display">{count}</div>

        <div className="knee-angle-display">
          {kneeAngle !== null ? `무릎 각도 ${kneeAngle}°` : ''}
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="controls">
        <button
          className="btn btn-start"
          onClick={start}
          disabled={!isReady || isRunning}
        >
          시작
        </button>
        <button className="btn btn-stop" onClick={stop} disabled={!isRunning}>
          정지
        </button>
        <button className="btn btn-reset" onClick={reset} disabled={isRunning}>
          리셋
        </button>
      </div>
    </div>
  )
}

export default App
