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

  return (
    <div className="app">
      {/* 카메라 풀스크린 영역 */}
      <div className="camera-container">
        <video ref={videoRef} className="camera-video" playsInline muted />
        <canvas ref={canvasRef} className="pose-canvas" />

        {/* 상단 헤더 오버레이 */}
        <div className="overlay-header">
          <span className="overlay-title">WOD CAM</span>
          <div className="status-indicator">
            <div className={`status-dot ${isRunning ? 'running' : isReady ? 'ready' : 'loading'}`} />
            <span>{isRunning ? 'LIVE' : isReady ? 'READY' : loadingMsg}</span>
          </div>
        </div>

        {/* 좌상단 카운트 정보 오버레이 */}
        {isRunning && (
          <div className="info-overlay">
            <div className={`squat-phase-badge phase-${squatPhase}`}>
              {squatPhase === 'down' ? 'DOWN ▼' : 'UP ▲'}
            </div>
            <div className={`count-display ${!isBodyDetected ? 'locked' : ''}`}>
              {count}
            </div>
            {kneeAngle !== null && (
              <div className="knee-angle-display">{kneeAngle}°</div>
            )}
          </div>
        )}

        {/* 하단 안내 메시지 */}
        {isRunning && guidanceMsg && (
          <div className="guidance-overlay">
            <span className="guidance-msg">{guidanceMsg}</span>
          </div>
        )}

        {isRunning && isBodyDetected && (
          <div className="ready-badge">준비 완료 ✓</div>
        )}

        {/* 카메라 미실행 플레이스홀더 */}
        {!isRunning && (
          <div className="camera-placeholder">
            <div className="camera-icon">📷</div>
            <span>{isReady ? '시작 버튼을 눌러주세요' : loadingMsg}</span>
          </div>
        )}

        {/* 모델 로딩 */}
        {!isReady && (
          <div className="loading-overlay">
            <div className="loading-spinner" />
            <span>{loadingMsg}</span>
          </div>
        )}

        {/* 카메라 전환 */}
        <button
          className="btn-switch-camera"
          onClick={switchCamera}
          disabled={!isReady}
          title={facingMode === 'environment' ? '전면 카메라로 전환' : '후면 카메라로 전환'}
        >
          {facingMode === 'environment' ? '🤳' : '📷'}
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {/* 컨트롤 버튼 */}
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
