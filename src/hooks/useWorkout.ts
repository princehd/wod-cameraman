import { useRef, useState, useCallback, useEffect, type RefObject } from 'react'
import {
  PoseLandmarker,
  FilesetResolver,
  type NormalizedLandmark,
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
const VISIBILITY_THRESHOLD = 0.6
const MIN_REP_INTERVAL_MS = 800
const SMOOTH_FRAMES = 5
const LANDMARK_SMOOTH_FRAMES = 6  // 좌표 스무딩 프레임 수

// 최근 N프레임 관절 좌표 평균 → 시각적 떨림 제거
function getSmoothedLandmarks(buffer: NormalizedLandmark[][]): NormalizedLandmark[] {
  const len = buffer.length
  return buffer[0].map((_, i) => ({
    x: buffer.reduce((s, f) => s + f[i].x, 0) / len,
    y: buffer.reduce((s, f) => s + f[i].y, 0) / len,
    z: buffer.reduce((s, f) => s + (f[i].z ?? 0), 0) / len,
    // visibility는 최신 프레임 기준 (불투명도 반응 빠르게)
    visibility: buffer[len - 1][i].visibility ?? 1,
  }))
}

// visibility 기반 불투명도로 관절/연결선 그리기
function drawPose(
  ctx: CanvasRenderingContext2D,
  landmarks: NormalizedLandmark[],
  w: number,
  h: number,
) {
  const px = (lm: NormalizedLandmark) => lm.x * w
  const py = (lm: NormalizedLandmark) => lm.y * h

  // 연결선
  for (const { start, end } of PoseLandmarker.POSE_CONNECTIONS) {
    const a = landmarks[start]
    const b = landmarks[end]
    const alpha = Math.min(a.visibility ?? 1, b.visibility ?? 1)
    if (alpha < 0.15) continue
    ctx.save()
    ctx.globalAlpha = Math.min(alpha, 0.9)
    ctx.strokeStyle = '#00ff88'
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(px(a), py(a))
    ctx.lineTo(px(b), py(b))
    ctx.stroke()
    ctx.restore()
  }

  // 관절 점
  for (const lm of landmarks) {
    const alpha = lm.visibility ?? 1
    if (alpha < 0.15) continue
    ctx.save()
    ctx.globalAlpha = Math.min(alpha, 0.95)
    ctx.beginPath()
    ctx.arc(px(lm), py(lm), 4, 0, Math.PI * 2)
    ctx.fillStyle = '#00ff88'
    ctx.fill()
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.restore()
  }
}

export type SquatPhase = 'up' | 'down'

// 가이드 실루엣 (전신이 안 보일 때 캔버스에 표시)
function drawSilhouette(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const cx = w / 2
  const s = h

  const headCY = s * 0.09
  const headR  = s * 0.06
  const neckY  = s * 0.16
  const shldrY = s * 0.22
  const shldrX = s * 0.13
  const elbowY = s * 0.37
  const elbowX = s * 0.17
  const wristY = s * 0.51
  const wristX = s * 0.15
  const hipY   = s * 0.54
  const hipX   = s * 0.09
  const kneeY  = s * 0.72
  const kneeX  = s * 0.08
  const ankleY = s * 0.90
  const ankleX = s * 0.07

  ctx.save()
  ctx.strokeStyle = 'rgba(255,255,255,0.75)'
  ctx.lineWidth   = Math.max(3, s * 0.007)
  ctx.lineCap     = 'round'
  ctx.lineJoin    = 'round'
  ctx.shadowColor = 'rgba(255,255,255,0.4)'
  ctx.shadowBlur  = 6
  ctx.setLineDash([s * 0.016, s * 0.008])

  // 머리
  ctx.beginPath()
  ctx.arc(cx, headCY, headR, 0, Math.PI * 2)
  ctx.stroke()

  // 척추
  ctx.beginPath()
  ctx.moveTo(cx, neckY)
  ctx.lineTo(cx, hipY)
  ctx.stroke()

  // 어깨
  ctx.beginPath()
  ctx.moveTo(cx - shldrX, shldrY)
  ctx.lineTo(cx + shldrX, shldrY)
  ctx.stroke()

  // 팔 (좌우)
  for (const side of [-1, 1] as const) {
    ctx.beginPath()
    ctx.moveTo(cx + side * shldrX, shldrY)
    ctx.lineTo(cx + side * elbowX, elbowY)
    ctx.lineTo(cx + side * wristX, wristY)
    ctx.stroke()
  }

  // 엉덩이
  ctx.beginPath()
  ctx.moveTo(cx - hipX, hipY)
  ctx.lineTo(cx + hipX, hipY)
  ctx.stroke()

  // 다리 (좌우)
  for (const side of [-1, 1] as const) {
    ctx.beginPath()
    ctx.moveTo(cx + side * hipX, hipY)
    ctx.lineTo(cx + side * kneeX, kneeY)
    ctx.lineTo(cx + side * ankleX, ankleY)
    ctx.stroke()
  }

  ctx.restore()
}

// 어느 부위가 안 보이는지에 따른 안내 메시지
function computeGuidanceMsg(landmarks: NormalizedLandmark[]): string {
  const vis = (idx: number) => landmarks[idx]?.visibility ?? 0
  const ankleVis = Math.max(vis(LM.LEFT_ANKLE), vis(LM.RIGHT_ANKLE))
  const kneeVis  = Math.max(vis(LM.LEFT_KNEE),  vis(LM.RIGHT_KNEE))
  const hipVis   = Math.max(vis(LM.LEFT_HIP),   vis(LM.RIGHT_HIP))

  if (ankleVis < VISIBILITY_THRESHOLD) return '뒤로 물러나세요'
  if (kneeVis  < VISIBILITY_THRESHOLD) return '무릎이 보이지 않아요'
  if (hipVis   < VISIBILITY_THRESHOLD) return '카메라를 낮춰주세요'
  return ''
}

export function useWorkout(
  videoRef: RefObject<HTMLVideoElement | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
) {
  const [isReady, setIsReady] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [isBodyDetected, setIsBodyDetected] = useState(false)
  const [guidanceMsg, setGuidanceMsg] = useState('')
  const [count, setCount] = useState(0)
  const [squatPhase, setSquatPhase] = useState<SquatPhase>('up')
  const [kneeAngle, setKneeAngle] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadingMsg, setLoadingMsg] = useState('모델 로딩 중...')
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment')

  const poseLandmarkerRef  = useRef<PoseLandmarker | null>(null)
  const rafRef             = useRef<number | null>(null)
  const isRunningRef       = useRef(false)
  const squatPhaseRef      = useRef<SquatPhase>('up')
  const countRef           = useRef(0)
  const lastVideoTimeRef   = useRef(-1)
  const lastRepTimeRef     = useRef(0)
  const angleBufferRef     = useRef<number[]>([])
  const landmarkBufferRef  = useRef<NormalizedLandmark[][]>([])

  useEffect(() => {
    let cancelled = false
    async function init() {
      try {
        setLoadingMsg('WASM 로딩 중...')
        const vision = await FilesetResolver.forVisionTasks(WASM_URL)
        if (cancelled) return

        setLoadingMsg('AI 모델 로딩 중...')
        const lm = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
          runningMode: 'VIDEO',
          numPoses: 1,
        })
        if (cancelled) { lm.close(); return }
        poseLandmarkerRef.current = lm
        setIsReady(true)
      } catch {
        if (!cancelled) setError('AI 모델 로딩 실패. 인터넷 연결을 확인하세요.')
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
    const video  = videoRef.current
    const canvas = canvasRef.current
    const lm     = poseLandmarkerRef.current

    if (!isRunningRef.current || !video || !canvas || !lm) return

    if (video.readyState < 2 || video.currentTime === lastVideoTimeRef.current) {
      rafRef.current = requestAnimationFrame(runDetection)
      return
    }
    lastVideoTimeRef.current = video.currentTime

    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width  = video.videoWidth  || 640
      canvas.height = video.videoHeight || 480
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const results = lm.detectForVideo(video, performance.now())
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // 사람이 전혀 감지 안 될 때
    if (results.landmarks.length === 0) {
      drawSilhouette(ctx, canvas.width, canvas.height)
      setIsBodyDetected(false)
      setGuidanceMsg('카메라 앞에 서주세요')
      rafRef.current = requestAnimationFrame(runDetection)
      return
    }

    const landmarks = results.landmarks[0]

    // 좌표 스무딩: 최근 N프레임 버퍼에 추가 후 평균
    landmarkBufferRef.current.push(landmarks)
    if (landmarkBufferRef.current.length > LANDMARK_SMOOTH_FRAMES) {
      landmarkBufferRef.current.shift()
    }
    const smoothedLandmarks = getSmoothedLandmarks(landmarkBufferRef.current)

    // visibility 기반 불투명도로 스켈레톤 그리기
    drawPose(ctx, smoothedLandmarks, canvas.width, canvas.height)

    // 주요 관절 가시성 검증
    const keyPoints = [
      landmarks[LM.LEFT_HIP],  landmarks[LM.RIGHT_HIP],
      landmarks[LM.LEFT_KNEE], landmarks[LM.RIGHT_KNEE],
      landmarks[LM.LEFT_ANKLE],landmarks[LM.RIGHT_ANKLE],
    ]
    const allVisible = keyPoints.every((p) => (p.visibility ?? 0) >= VISIBILITY_THRESHOLD)

    if (!allVisible) {
      drawSilhouette(ctx, canvas.width, canvas.height)
      setIsBodyDetected(false)
      setGuidanceMsg(computeGuidanceMsg(landmarks))
      rafRef.current = requestAnimationFrame(runDetection)
      return
    }

    // 전신 감지 완료
    setIsBodyDetected(true)
    setGuidanceMsg('')

    // 각도 계산 + 스무딩
    const rawAngle = (
      angleBetweenPoints(landmarks[LM.LEFT_HIP],  landmarks[LM.LEFT_KNEE],  landmarks[LM.LEFT_ANKLE]) +
      angleBetweenPoints(landmarks[LM.RIGHT_HIP], landmarks[LM.RIGHT_KNEE], landmarks[LM.RIGHT_ANKLE])
    ) / 2

    angleBufferRef.current.push(rawAngle)
    if (angleBufferRef.current.length > SMOOTH_FRAMES) angleBufferRef.current.shift()
    const smoothed = angleBufferRef.current.reduce((a, b) => a + b, 0) / angleBufferRef.current.length

    setKneeAngle(Math.round(smoothed))

    if (squatPhaseRef.current === 'up' && smoothed < ANGLE_DOWN) {
      squatPhaseRef.current = 'down'
      setSquatPhase('down')
    } else if (squatPhaseRef.current === 'down' && smoothed > ANGLE_UP) {
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

    rafRef.current = requestAnimationFrame(runDetection)
  }, [videoRef, canvasRef, speak])

  const startCamera = useCallback(async (facing: 'environment' | 'user') => {
    if (!videoRef.current || !isReady) return
    setError(null)

    if (window.speechSynthesis) {
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(''))
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facing }, width: { ideal: 480 }, height: { ideal: 640 } },
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
      if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
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
    setIsBodyDetected(false)
    setGuidanceMsg('')
    landmarkBufferRef.current = []
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    const video = videoRef.current
    if (video?.srcObject) {
      ;(video.srcObject as MediaStream).getTracks().forEach((t) => t.stop())
      video.srcObject = null
    }
    canvasRef.current?.getContext('2d')?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
  }, [videoRef, canvasRef])

  const reset = useCallback(() => {
    countRef.current = 0
    squatPhaseRef.current = 'up'
    lastRepTimeRef.current = 0
    angleBufferRef.current = []
    landmarkBufferRef.current = []
    setCount(0)
    setSquatPhase('up')
    setKneeAngle(null)
  }, [])

  useEffect(() => {
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current) }
  }, [])

  return {
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
  }
}
