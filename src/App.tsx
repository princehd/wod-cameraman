import { useRef } from 'react'
import { useWorkout } from './hooks/useWorkout'
import './App.css'

function App() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const {
    isReady,
    isRunning,
    isBodyDetected,
    guidanceMsg,
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
          <div className={`status-dot ${isRunning ? 'running' : isReady ? 'ready' : 'loading'}`} />
          <span>{statusLabel}</span>
        </div>
      </header>

      <div className="camera-container">
        <video ref={videoRef} className="camera-video" playsInline muted />
        <canvas ref={canvasRef} className="pose-canvas" />

        {/* 카메라 미실행 시 플레이스홀더 */}
        {!isRunning && (
          <div className="camera-placeholder">
            <div className="camera-icon">📷</div>
            <span>{isReady ? '시작 버튼을 눌러주세요' : loadingMsg}</span>
          </div>
        )}

        {/* 전신 미감지 시 안내 메시지 */}
        {isRunning && guidanceMsg && (
          <div className="guidance-overlay">
            <span className="guidance-msg">{guidanceMsg}</span>
          </div>
        )}

        {/* 전신 감지 완료 표시 */}
        {isRunning && isBodyDetected && (
          <div className="ready-badge">준비 완료 ✓</div>
        )}

        {/* 모델 로딩 오버레이 */}
        {!isReady && (
          <div className="loading-overlay">
            <div className="loading-spinner" />
            <span>{loadingMsg}</span>
          </div>
        )}

        {/* 카메라 전환 버튼 */}
        <button
          className="btn-switch-camera"
          onClick={switchCamera}
          disabled={!isReady}
          title={facingMode === 'environment' ? '전면 카메라로 전환' : '후면 카메라로 전환'}
        >
          {facingMode === 'environment' ? '🤳' : '📷'}
        </button>
      </div>

      <div className="count-section">
        <div className={`squat-phase-badge phase-${squatPhase}`}>
          {squatPhase === 'down' ? 'DOWN ▼' : 'UP ▲'}
        </div>

        <div className={`count-display ${isRunning && !isBodyDetected ? 'locked' : ''}`}>
          {count}
        </div>

        <div className="knee-angle-display">
          {kneeAngle !== null ? `무릎 각도 ${kneeAngle}°` : ''}
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="controls">
        <button className="btn btn-start" onClick={start} disabled={!isReady || isRunning}>
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
