import { useRef, useState, useCallback, useEffect, type RefObject } from 'react'
import {
  PoseLandmarker,
  FilesetResolver,
  DrawingUtils,
} from '@mediapipe/tasks-vision'
import { angleBetweenPoints } from '../utils/geometry'

const WASM_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task'

const LM = {
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
} as const

const ANGLE_DOWN = 100
const ANGLE_UP = 160
const VISIBILITY_THRESHOLD = 0.6  // 방안 1: 가시성 필터
const MIN_REP_INTERVAL_MS = 800   // 방안 2: 최소 rep 간격
const SMOOTH_FRAMES = 5           // 방안 3: 스무딩 프레임 수

export type SquatPhase = 'up' | 'down'

export function useWorkout(
  videoRef: RefObject<HTMLVideoElement | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
) {
  const [isReady, setIsReady] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [count, setCount] = useState(0)
  const [squatPhase, setSquatPhase] = useState<SquatPhase>('up')
  const [kneeAngle, setKneeAngle] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadingMsg, setLoadingMsg] = useState('모델 로딩 중...')
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment')

  const poseLandmarkerRef = useRef<PoseLandmarker | null>(null)
  const drawingUtilsRef = useRef<DrawingUtils | null>(null)
  const rafRef = useRef<number | null>(null)
  const isRunningRef = useRef(false)
  const squatPhaseRef = useRef<SquatPhase>('up')
  const countRef = useRef(0)
  const lastVideoTimeRef = useRef(-1)
  const lastRepTimeRef = useRef(0)        // 방안 2: 마지막 rep 시각
  const angleBufferRef = useRef<number[]>([])  // 방안 3: 각도 스무딩 버퍼

  // Initialize MediaPipe
  useEffect(() => {
    let cancelled = false
    async function init() {
      try {
        setLoadingMsg('WASM 로딩 중...')
        const vision = await FilesetResolver.forVisionTasks(WASM_URL)
        if (cancelled) return

        setLoadingMsg('AI 모델 로딩 중...')
        const lm = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: MODEL_URL,
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numPoses: 1,
        })
        if (cancelled) {
          lm.close()
          return
        }
        poseLandmarkerRef.current = lm
        setIsReady(true)
      } catch {
        if (!cancelled) {
          setError('AI 모델 로딩 실패. 인터넷 연결을 확인하세요.')
        }
      }
    }
    init()
    return () => {
      cancelled = true
      poseLandmarkerRef.current?.close()
      poseLandmarkerRef.current = null
    }
  }, [])

  const speak = useCallback((text: string) => {
    if (!window.speechSynthesis) return
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = 1.2
    utterance.volume = 1.0
    window.speechSynthesis.speak(utterance)
  }, [])

  const runDetection = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    const lm = poseLandmarkerRef.current

    if (!isRunningRef.current || !video || !canvas || !lm) return

    if (video.readyState < 2 || video.currentTime === lastVideoTimeRef.current) {
      rafRef.current = requestAnimationFrame(runDetection)
      return
    }
    lastVideoTimeRef.current = video.currentTime

    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth || 640
      canvas.height = video.videoHeight || 480
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const results = lm.detectForVideo(video, performance.now())
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    if (results.landmarks.length > 0) {
      const landmarks = results.landmarks[0]

      if (!drawingUtilsRef.current) {
        drawingUtilsRef.current = new DrawingUtils(ctx)
      }
      drawingUtilsRef.current.drawConnectors(
        landmarks,
        PoseLandmarker.POSE_CONNECTIONS,
        { color: '#00ff88', lineWidth: 2 },
      )
      drawingUtilsRef.current.drawLandmarks(landmarks, {
        color: '#ffffff',
        fillColor: '#00ff88',
        radius: 4,
      })

      // 방안 1: 주요 관절 가시성 검증
      const keyPoints = [
        landmarks[LM.LEFT_HIP], landmarks[LM.RIGHT_HIP],
        landmarks[LM.LEFT_KNEE], landmarks[LM.RIGHT_KNEE],
        landmarks[LM.LEFT_ANKLE], landmarks[LM.RIGHT_ANKLE],
      ]
      const allVisible = keyPoints.every(
        (lm) => (lm.visibility ?? 0) >= VISIBILITY_THRESHOLD,
      )
      if (!allVisible) {
        rafRef.current = requestAnimationFrame(runDetection)
        return
      }

      const leftAngle = angleBetweenPoints(
        landmarks[LM.LEFT_HIP],
        landmarks[LM.LEFT_KNEE],
        landmarks[LM.LEFT_ANKLE],
      )
      const rightAngle = angleBetweenPoints(
        landmarks[LM.RIGHT_HIP],
        landmarks[LM.RIGHT_KNEE],
        landmarks[LM.RIGHT_ANKLE],
      )
      const rawAngle = (leftAngle + rightAngle) / 2

      // 방안 3: 이동 평균으로 각도 스무딩
      angleBufferRef.current.push(rawAngle)
      if (angleBufferRef.current.length > SMOOTH_FRAMES) {
        angleBufferRef.current.shift()
      }
      const smoothed =
        angleBufferRef.current.reduce((a, b) => a + b, 0) /
        angleBufferRef.current.length

      setKneeAngle(Math.round(smoothed))

      if (squatPhaseRef.current === 'up' && smoothed < ANGLE_DOWN) {
        squatPhaseRef.current = 'down'
        setSquatPhase('down')
      } else if (squatPhaseRef.current === 'down' && smoothed > ANGLE_UP) {
        // 방안 2: 최소 rep 간격 체크
        const now = performance.now()
        if (now - lastRepTimeRef.current >= MIN_REP_INTERVAL_MS) {
          squatPhaseRef.current = 'up'
          setSquatPhase('up')
          lastRepTimeRef.current = now
          countRef.current += 1
          setCount(countRef.current)
          speak(String(countRef.current))
        }
      }
    }

    rafRef.current = requestAnimationFrame(runDetection)
  }, [videoRef, canvasRef, speak])

  const startCamera = useCallback(async (facing: 'environment' | 'user') => {
    if (!videoRef.current || !isReady) return
    setError(null)

    // iOS PWA: unlock speech synthesis on user interaction
    if (window.speechSynthesis) {
      const unlock = new SpeechSynthesisUtterance('')
      window.speechSynthesis.speak(unlock)
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facing },
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false,
      })
      const video = videoRef.current
      video.srcObject = stream
      await video.play()
      lastVideoTimeRef.current = -1
      isRunningRef.current = true
      setIsRunning(true)
      rafRef.current = requestAnimationFrame(runDetection)
    } catch {
      setError('카메라 접근 실패. 카메라 권한을 허용해주세요.')
    }
  }, [videoRef, isReady, runDetection])

  const start = useCallback(() => startCamera(facingMode), [startCamera, facingMode])

  const switchCamera = useCallback(async () => {
    const next = facingMode === 'environment' ? 'user' : 'environment'
    setFacingMode(next)
    if (isRunning) {
      isRunningRef.current = false
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      const video = videoRef.current
      if (video?.srcObject) {
        ;(video.srcObject as MediaStream).getTracks().forEach((t) => t.stop())
        video.srcObject = null
      }
      await startCamera(next)
    }
  }, [facingMode, isRunning, videoRef, startCamera])

  const stop = useCallback(() => {
    isRunningRef.current = false
    setIsRunning(false)
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    const video = videoRef.current
    if (video?.srcObject) {
      ;(video.srcObject as MediaStream).getTracks().forEach((t) => t.stop())
      video.srcObject = null
    }
    const canvas = canvasRef.current
    if (canvas) {
      canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
    }
  }, [videoRef, canvasRef])

  const reset = useCallback(() => {
    countRef.current = 0
    squatPhaseRef.current = 'up'
    lastRepTimeRef.current = 0
    angleBufferRef.current = []
    setCount(0)
    setSquatPhase('up')
    setKneeAngle(null)
  }, [])

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  return {
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
  }
}
