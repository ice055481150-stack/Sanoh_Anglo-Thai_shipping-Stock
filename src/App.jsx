import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from './supabaseClient';
import {
  Plus, Package, TrendingUp, Layers, AlertTriangle,
  CheckCircle2, Download, Search, Trash2, X, DollarSign,
  Pencil, ShieldCheck, UserCheck, LogOut, KeyRound, Lock,
  UserPlus, SlidersHorizontal, ClipboardCheck, Bell, Check, Ban, CalendarDays,
  StopCircle, Calendar, Volume2, VolumeX, Eye, EyeOff, Power
} from 'lucide-react';

// สร้างรหัสอนุมัติแบบ 1 ครั้ง/1 รายการ (APV-...) หรือรหัสใช้ได้หลายรายการ/ตามวันที่เลือก (DAY-...)
const generateApprovalCode = (scope = 'single_item') => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let randomPart = '';
  for (let i = 0; i < 6; i++) {
    randomPart += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  const suffix = String(Date.now()).slice(-4);
  const prefix = scope === 'daily_multi' ? 'DAY' : 'APV';
  return `${prefix}-${randomPart}-${suffix}`;
};

// คืนค่าวันที่ปัจจุบันในรูปแบบ YYYY-MM-DD ตามเวลาเครื่อง (Local Time)
const getTodayDateInputValue = () => {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

// แปลงวันที่ YYYY-MM-DD + เวลา HH:MM เป็น ISO string
const buildExpiryIsoFromDate = (dateStr, timeStr = '23:59') => {
  const fallbackDate = getTodayDateInputValue();
  const targetDate = /^\d{4}-\d{2}-\d{2}$/.test(dateStr || '') ? dateStr : fallbackDate;
  const [year, month, day] = targetDate.split('-').map(Number);
  const [hour, minute] = (timeStr || '23:59').split(':').map(Number);
  const dt = new Date(
    year,
    (month || 1) - 1,
    day || 1,
    Number.isFinite(hour) ? hour : 23,
    Number.isFinite(minute) ? minute : 59,
    59,
    999
  );
  return dt.toISOString();
};

// ตรวจสอบว่ารหัสยังใช้งานได้อยู่หรือไม่ (ไม่ถูกหยุด/ไม่ถูกใช้ และยังไม่หมดเวลา)
const isCodeActive = (row) => {
  if (!row || row.status !== 'approved' || row.used || !row.one_time_code) return false;
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) return false;
  return true;
};

const formatThaiDateTime = (isoStr) => {
  if (!isoStr) return '-';
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('th-TH', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

export default function App() {
  // --- Auth & Role State (เปิดเว็บมาใหม่ทุกครั้งจะเริ่มต้นที่ null เพื่อปิดระบบไว้ก่อน) ---
  const [currentUser, setCurrentUser] = useState(null);

  // Login Form State
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);

  // Timer Lifecycle State:
  // - scanInProgress: true ตั้งแต่เริ่มกดลากเครื่องสแกนจนหน้าจอหุบลงเสร็จ
  // - postScanReady: true เมื่อหน้าจอหุบลงและปลดล็อกพร้อมกรอกล็อกอินแล้ว (เริ่มนับ 20 วิ)
  // - loginPaused: true เมื่อกดหรือเริ่มกรอกข้อมูลในช่องล็อกอิน (หยุดนับรอบ 20 วิ ชั่วคราว)
  const [scanInProgress, setScanInProgress] = useState(false);
  const [postScanReady, setPostScanReady] = useState(false);
  const [loginPaused, setLoginPaused] = useState(false);

  // Warehouse Scanner Power & Login Stage State (เริ่มต้นปิดระบบและไฟคลังทุกครั้งที่เปิดเว็บใหม่)
  const [scanSystemPoweredOn, setScanSystemPoweredOn] = useState(false);
  const [warehouseLightsOn, setWarehouseLightsOn] = useState(false);
  const [scannerUnlocked, setScannerUnlocked] = useState(false);
  const [countdownSeconds, setCountdownSeconds] = useState(null);
  const [isScanningHold, setIsScanningHold] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [sweepPercent, setSweepPercent] = useState(0);
  const [monitorOpen, setMonitorOpen] = useState(false);
  const [audioMuted, setAudioMuted] = useState(false);
  const [scannerToast, setScannerToast] = useState(null);
  const [scannerReadout, setScannerReadout] = useState({
    state: 'POWER_OFF',
    screenTop: 'OFF',
    screenBottom: 'POWER DOWN',
    terminalStatus: 'SYSTEM_POWER_OFF',
    barcodeText: '',
    log: '> ระบบปิดอยู่ กด "เปิดคลัง" เพื่อเปิดไฟคลังและระบบสแกน'
  });

  const svgStageRef = useRef(null);
  const scannerGroupRef = useRef(null);
  const barcodeTargetRef = useRef(null);
  const scanTimerRef = useRef(null);
  const typingTimerRef = useRef(null);
  const monitorHideTimerRef = useRef(null);
  const idleCloseTimerRef = useRef(null);
  const countdownIntervalRef = useRef(null);
  const scanRelease2sTimerRef = useRef(null);
  const loginIdle2sTimerRef = useRef(null);
  const dragRef = useRef({
    dragging: false,
    pointerId: null,
    startClientX: 0,
    startClientY: 0,
    baseOffsetX: 0,
    baseOffsetY: 0,
    offsetX: 0,
    offsetY: 0
  });

  // Admin-only Staff Register Modal State (locked to role: 'user_shipping')
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState(false);
  const [staffFullName, setStaffFullName] = useState('');
  const [staffUsername, setStaffUsername] = useState('');
  const [staffPassword, setStaffPassword] = useState('');
  const [registeringStaff, setRegisteringStaff] = useState(false);

  // Admin Approval Requests & Audit Modal State
  const [isApprovalModalOpen, setIsApprovalModalOpen] = useState(false);
  const [approvalLogs, setApprovalLogs] = useState([]);
  const [loadingApprovalLogs, setLoadingApprovalLogs] = useState(false);
  const [processingRequestId, setProcessingRequestId] = useState(null);
  const [latestIssuedInfo, setLatestIssuedInfo] = useState(null);

  // เก็บวันที่และเวลาหมดอายุที่แอดมินเลือกแยกตาม id ของแต่ละคำขอ { [requestId]: { date: 'YYYY-MM-DD', time: '23:59' } }
  const [requestExpiryMap, setRequestExpiryMap] = useState({});

  // User Request Approval Code Modal State (รองรับทั้ง 1 รายการ และใช้ได้ทั้งวัน/หลายรายการ + ยืนยันตัวตน)
  const [requestModalItem, setRequestModalItem] = useState(null);
  const [requestScope, setRequestScope] = useState('single_item'); // 'single_item' | 'daily_multi'
  const [requestNote, setRequestNote] = useState('');
  const [verifyUsername, setVerifyUsername] = useState('');
  const [verifyPassword, setVerifyPassword] = useState('');
  const [submittingRequest, setSubmittingRequest] = useState(false);

  // หน้าต่างรับรหัสอัตโนมัติ / รายการคำขอของ User
  const [myRequestsModalOpen, setMyRequestsModalOpen] = useState(false);
  const [liveIssuedBanner, setLiveIssuedBanner] = useState(null);
  const seenApprovedIdsRef = useRef(new Set());

  const isAdmin = currentUser?.role === 'admin_shipping';

  // --- Stock State ---
  const [neckTags, setNeckTags] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [searchTerm, setSearchTerm] = useState('');

  // State สำหรับ Modal เพิ่มรายการใหม่
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [dateIn, setDateIn] = useState('');
  const [productCode, setProductCode] = useState('');
  const [customNo, setCustomNo] = useState('');
  const [refDoc, setRefDoc] = useState('');
  const [productName, setProductName] = useState('');
  const [totalQty, setTotalQty] = useState('');
  const [totalQtyBo, setTotalQtyBo] = useState('');
  const [price, setPrice] = useState('');

  // State สำหรับ Modal กรอกจำนวนขวด และ/หรือ จำนวนลัง โดยตรง (User & Admin)
  const [qtyModalItem, setQtyModalItem] = useState(null);
  const [directBottles, setDirectBottles] = useState('');
  const [directCases, setDirectCases] = useState('');
  const [savingDirectQty, setSavingDirectQty] = useState(false);

  // State สำหรับ Modal แก้ไขรายการสินค้า (Admin แก้ได้อิสระ / User ต้องใช้รหัสอนุมัติ)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [approvalCodeInput, setApprovalCodeInput] = useState('');
  const [editProductName, setEditProductName] = useState('');
  const [editProductCode, setEditProductCode] = useState('');
  const [editTotalQty, setEditTotalQty] = useState('');
  const [editTotalQtyBo, setEditTotalQtyBo] = useState('');
  const [editPrice, setEditPrice] = useState('');
  const [editCustomNo, setEditCustomNo] = useState('');
  const [editRefDoc, setEditRefDoc] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const showScannerToast = (title, msg, icon = '✓') => {
    setScannerToast({ title, msg, icon });
    window.clearTimeout(showScannerToast._t);
    showScannerToast._t = window.setTimeout(() => setScannerToast(null), 3500);
  };

  const playScannerTone = (freq = 920, ms = 110) => {
    if (audioMuted) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.value = 0.035;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      setTimeout(() => {
        osc.stop();
        ctx.close();
      }, ms);
    } catch {
      // ข้ามหากเบราว์เซอร์จำกัดเสียง
    }
  };

  const clearScanAnimations = () => {
    window.clearInterval(scanTimerRef.current);
    scanTimerRef.current = null;
    window.clearInterval(typingTimerRef.current);
    typingTimerRef.current = null;
    window.clearTimeout(monitorHideTimerRef.current);
    monitorHideTimerRef.current = null;
  };

  const clearIdleLoginTimer = useCallback(() => {
    window.clearTimeout(idleCloseTimerRef.current);
    idleCloseTimerRef.current = null;
    window.clearInterval(countdownIntervalRef.current);
    countdownIntervalRef.current = null;
    setCountdownSeconds(null);
  }, []);

  const clear2sTimers = useCallback(() => {
    window.clearTimeout(scanRelease2sTimerRef.current);
    scanRelease2sTimerRef.current = null;
    window.clearTimeout(loginIdle2sTimerRef.current);
    loginIdle2sTimerRef.current = null;
  }, []);

  // รีเซ็ตตัวจับเวลา 2 วินาทีเมื่อมีการกดหรือกรอกข้อมูลในช่องล็อกอิน
  const touchLoginActivity = useCallback(() => {
    if (!postScanReady) return;
    setLoginPaused(true);
    clearIdleLoginTimer();
    window.clearTimeout(loginIdle2sTimerRef.current);
    loginIdle2sTimerRef.current = window.setTimeout(() => {
      setLoginPaused(false);
    }, 2000);
  }, [postScanReady, clearIdleLoginTimer]);

  // ปิดระบบสแกน ไฟคลัง และซ่อนการ์ดล็อกอินกลับสู่สถานะเริ่มต้น
  const powerOffLoginStage = useCallback((toastTitle, toastMsg, toastIcon = '⏻') => {
    clearScanAnimations();
    clearIdleLoginTimer();
    clear2sTimers();
    dragRef.current.dragging = false;
    dragRef.current.pointerId = null;
    setScanInProgress(false);
    setPostScanReady(false);
    setLoginPaused(false);
    setScanSystemPoweredOn(false);
    setWarehouseLightsOn(false);
    setIsScanningHold(false);
    setScanProgress(0);
    setSweepPercent(0);
    setMonitorOpen(false);
    setScannerUnlocked(false);
    dragRef.current.baseOffsetX = 0;
    dragRef.current.baseOffsetY = 0;
    dragRef.current.offsetX = 0;
    dragRef.current.offsetY = 0;
    if (scannerGroupRef.current) {
      scannerGroupRef.current.setAttribute('transform', 'translate(0, 0)');
    }
    setScannerReadout({
      state: 'POWER_OFF',
      screenTop: 'OFF',
      screenBottom: 'POWER DOWN',
      terminalStatus: 'SYSTEM_POWER_OFF',
      barcodeText: '',
      log: '> ระบบปิดอยู่ กด "เปิดคลัง" เพื่อเปิดไฟคลังและระบบสแกน'
    });
    if (toastTitle) {
      showScannerToast(toastTitle, toastMsg, toastIcon);
    }
  }, [clearIdleLoginTimer, clear2sTimers]);

  // เปิดระบบสแกน ไฟคลัง และแสดงการ์ดล็อกอิน
  const powerOnLoginStage = useCallback((options = {}) => {
    const { unlockImmediately = false, silentToast = false } = options;
    clearScanAnimations();
    clearIdleLoginTimer();
    clear2sTimers();
    dragRef.current.dragging = false;
    dragRef.current.pointerId = null;
    dragRef.current.baseOffsetX = 0;
    dragRef.current.baseOffsetY = 0;
    dragRef.current.offsetX = 0;
    dragRef.current.offsetY = 0;
    if (scannerGroupRef.current) {
      scannerGroupRef.current.setAttribute('transform', 'translate(0, 0)');
    }
    setScanInProgress(false);
    setPostScanReady(unlockImmediately);
    setLoginPaused(false);
    setScanSystemPoweredOn(true);
    setWarehouseLightsOn(true);
    setScannerUnlocked(unlockImmediately);
    setIsScanningHold(false);
    setScanProgress(unlockImmediately ? 100 : 0);
    setSweepPercent(unlockImmediately ? 100 : 0);
    setMonitorOpen(false);
    setScannerReadout({
      state: unlockImmediately ? 'UNLOCKED_ONLINE' : 'IDLE_READY',
      screenTop: unlockImmediately ? 'UNLOCKED' : 'READY',
      screenBottom: unlockImmediately ? 'LOGIN READY' : 'DRAG TO CODE',
      terminalStatus: unlockImmediately ? 'LOGIN_UNLOCKED' : 'WAITING_FOR_SCAN...',
      barcodeText: unlockImmediately ? 'WMS-8829-4012' : '',
      log: unlockImmediately
        ? '> พร้อมเข้าสู่ระบบ กรอกบัญชีเพื่อเข้าใช้งานหรือเปลี่ยนบัญชี'
        : '> เปิดไฟคลังสินค้าและระบบสแกนแล้ว ลากเครื่องสแกนไปทาบค้างไว้ 2 วินาที'
    });
    if (!silentToast) {
      playScannerTone(980, 140);
      showScannerToast('เปิดคลังแล้ว', 'ไฟคลังสินค้าติดแล้ว กรุณาสแกนบาร์โค้ดเพื่อปลดล็อก', '⚡');
    }
  }, [clearIdleLoginTimer, clear2sTimers]);

  // เมื่อสแกนครบ 2 วินาที: เปิดหน้าจอคอม จำลองกรอกบาร์โค้ดทีละตัวอักษร แจ้งปลดล็อก แล้วหุบหน้าจอลงไวขึ้น (450ms) และเริ่มนับ 20 วินาที
  const finishScanUnlock = () => {
    clearScanAnimations();
    window.clearTimeout(scanRelease2sTimerRef.current);
    scanRelease2sTimerRef.current = null;
    setIsScanningHold(false);
    setScanProgress(100);
    setSweepPercent(100);
    setMonitorOpen(true);
    playScannerTone(1040, 140);

    const fullBarcode = 'WMS-8829-4012';
    setScannerReadout({
      state: 'TYPING_BARCODE',
      screenTop: 'SCANNED',
      screenBottom: 'SENDING...',
      terminalStatus: 'TYPING_BARCODE_TO_SYSTEM...',
      barcodeText: '',
      log: '> กำลังจำลองการกรอกรหัสบาร์โค้ดเข้าสู่ระบบ...'
    });

    let charIndex = 0;
    typingTimerRef.current = window.setInterval(() => {
      charIndex += 1;
      const currentTyped = fullBarcode.slice(0, charIndex);
      setScannerReadout((prev) => ({
        ...prev,
        barcodeText: currentTyped
      }));
      playScannerTone(860 + (charIndex % 4) * 70, 45);

      if (charIndex >= fullBarcode.length) {
        window.clearInterval(typingTimerRef.current);
        typingTimerRef.current = null;

        setScannerUnlocked(true);
        playScannerTone(1320, 200);
        setScannerReadout({
          state: 'UNLOCKED_ONLINE',
          screenTop: 'UNLOCKED',
          screenBottom: 'LOGIN READY',
          terminalStatus: 'LOGIN_UNLOCKED',
          barcodeText: fullBarcode,
          log: '> ปลดล็อกการล็อกอินสำเร็จ! พร้อมเข้าสู่ระบบแล้ว'
        });

        monitorHideTimerRef.current = window.setTimeout(() => {
          setMonitorOpen(false);
          setScanInProgress(false);
          setLoginPaused(false);
          setPostScanReady(true);
        }, 450);
      }
    }, 65);
  };

  const beginScanHold = () => {
    if (!scanSystemPoweredOn || scannerUnlocked || scanTimerRef.current || typingTimerRef.current) return;
    window.clearTimeout(scanRelease2sTimerRef.current);
    scanRelease2sTimerRef.current = null;
    setIsScanningHold(true);
    setScannerReadout((prev) => ({
      ...prev,
      state: 'SCAN_BLINK_2S',
      screenTop: 'SCANNING',
      screenBottom: 'HOLD 2.0S',
      terminalStatus: 'READING_BARCODE...',
      barcodeText: '',
      log: '> กำลังสแกนบาร์โค้ด ค้างไว้ให้ครบ 2 วินาที...'
    }));

    const startedAt = Date.now();
    const totalMs = 2000;

    scanTimerRef.current = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const pct = Math.min(100, Math.round((elapsed / totalMs) * 100));
      setScanProgress(pct);
      setSweepPercent(pct);

      if (elapsed >= totalMs) {
        finishScanUnlock();
      }
    }, 50);
  };

  const abortScanHold = () => {
    if (!scanTimerRef.current) return;
    window.clearInterval(scanTimerRef.current);
    scanTimerRef.current = null;
    setIsScanningHold(false);
    if (!scannerUnlocked && !typingTimerRef.current) {
      setScanProgress(0);
      setSweepPercent(0);
      setMonitorOpen(false);
      setScannerReadout({
        state: 'IDLE_READY',
        screenTop: 'READY',
        screenBottom: 'DRAG TO CODE',
        terminalStatus: 'WAITING_FOR_SCAN...',
        barcodeText: '',
        log: '> เลื่อนออกก่อนครบ 2 วินาที กรุณาทาบบาร์โค้ดค้างไว้ใหม่'
      });
    }
  };

  const evaluateBarcodeHit = () => {
    if (!scanSystemPoweredOn) return;
    const scannerEl = scannerGroupRef.current;
    const targetEl = barcodeTargetRef.current;
    if (!scannerEl || !targetEl) return;

    const r1 = scannerEl.getBoundingClientRect();
    const r2 = targetEl.getBoundingClientRect();
    const overlaps = !(
      r1.right < r2.left ||
      r1.left > r2.right ||
      r1.bottom < r2.top ||
      r1.top > r2.bottom
    );

    if (overlaps) beginScanHold();
    else abortScanHold();
  };

  const getSvgScale = () => {
    const svgEl = svgStageRef.current;
    if (!svgEl) return { scaleX: 1, scaleY: 1 };
    const rect = svgEl.getBoundingClientRect();
    return {
      scaleX: rect.width ? 600 / rect.width : 1,
      scaleY: rect.height ? 420 / rect.height : 1
    };
  };

  const startScannerDrag = (clientX, clientY, pointerId = null) => {
    if (!scanSystemPoweredOn || scannerUnlocked) return;
    window.clearTimeout(scanRelease2sTimerRef.current);
    scanRelease2sTimerRef.current = null;
    setScanInProgress(true);
    clearIdleLoginTimer();

    dragRef.current.dragging = true;
    dragRef.current.pointerId = pointerId;
    dragRef.current.startClientX = clientX;
    dragRef.current.startClientY = clientY;
    dragRef.current.baseOffsetX = dragRef.current.offsetX;
    dragRef.current.baseOffsetY = dragRef.current.offsetY;
    playScannerTone(700, 70);
  };

  const moveScannerDrag = (clientX, clientY) => {
    if (!dragRef.current.dragging || !scanSystemPoweredOn || scannerUnlocked) return;
    const { scaleX, scaleY } = getSvgScale();
    const dx = (clientX - dragRef.current.startClientX) * scaleX;
    const dy = (clientY - dragRef.current.startClientY) * scaleY;
    const x = dragRef.current.baseOffsetX + dx;
    const y = dragRef.current.baseOffsetY + dy;

    dragRef.current.offsetX = x;
    dragRef.current.offsetY = y;
    if (scannerGroupRef.current) {
      scannerGroupRef.current.setAttribute('transform', `translate(${x}, ${y})`);
    }
    evaluateBarcodeHit();
  };

  const endScannerDrag = () => {
    if (!dragRef.current.dragging) return;
    dragRef.current.dragging = false;
    dragRef.current.pointerId = null;
    abortScanHold();

    // หากปล่อยเมาส์/นิ้วและไม่ได้อยู่ในช่วงที่กำลังสแกนค้าง/จอเด้ง/หุบ ให้เริ่มจับเวลา 2 วินาทีเพื่อกลับมานับเวลาใหม่
    if (!scannerUnlocked && !typingTimerRef.current && !monitorHideTimerRef.current) {
      window.clearTimeout(scanRelease2sTimerRef.current);
      scanRelease2sTimerRef.current = window.setTimeout(() => {
        setScanInProgress(false);
      }, 2000);
    }
  };

  const handleScannerPointerDown = (e) => {
    if (e.pointerType === 'touch') return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    startScannerDrag(e.clientX, e.clientY, e.pointerId);
  };

  const handleScannerPointerMove = (e) => {
    if (e.pointerType === 'touch') return;
    moveScannerDrag(e.clientX, e.clientY);
  };

  const handleScannerPointerUp = (e) => {
    if (e.pointerType === 'touch') return;
    endScannerDrag();
  };

  const handleScannerTouchStart = (e) => {
    if (!scanSystemPoweredOn || scannerUnlocked) return;
    const touch = e.touches[0];
    if (!touch) return;
    e.preventDefault();
    startScannerDrag(touch.clientX, touch.clientY, 'touch');
  };

  const handleScannerTouchMove = (e) => {
    if (!dragRef.current.dragging) return;
    const touch = e.touches[0];
    if (!touch) return;
    e.preventDefault();
    moveScannerDrag(touch.clientX, touch.clientY);
  };

  const handleScannerTouchEnd = (e) => {
    if (!dragRef.current.dragging) return;
    e.preventDefault();
    endScannerDrag();
  };

  // สวิตช์เปิด-ปิดคลัง (รวมไฟคลังสินค้า ระบบสแกน และระบบล็อกอิน)
  const handleToggleScanPower = () => {
    if (scanSystemPoweredOn) {
      playScannerTone(420, 120);
      powerOffLoginStage('ปิดคลังแล้ว', 'ปิดไฟคลัง ระบบสแกน และซ่อนหน้าล็อกอินแล้ว', '⏻');
    } else {
      powerOnLoginStage();
    }
  };

  // นับเวลาปิดคลังอัตโนมัติ:
  // - ก่อนสแกน: 10 วินาที
  // - ระหว่างกระบวนการสแกนจนหน้าจอหุบลง: ไม่นับเวลา (scanInProgress === true) ยกเว้นปล่อยเมาส์เกิน 2 วิจะเริ่มนับใหม่
  // - หลังหน้าจอหุบลงแล้ว: นับใหม่ 20 วินาที (postScanReady === true)
  // - เมื่อกดหรือเริ่มกรอกข้อมูลในช่องล็อกอิน: หยุดนับรอบ 20 วินาทีชั่วคราว (loginPaused === true) และหากไม่กรอกเกิน 2 วิจะเริ่มนับใหม่
  useEffect(() => {
    clearIdleLoginTimer();
    if (currentUser || !scanSystemPoweredOn || authLoading || scanInProgress) return;
    if (postScanReady && loginPaused) return;

    const initialSeconds = postScanReady ? 20 : 10;
    const timeoutMs = initialSeconds * 1000;
    setCountdownSeconds(initialSeconds);

    countdownIntervalRef.current = window.setInterval(() => {
      setCountdownSeconds((prev) => {
        if (prev === null) return null;
        return prev > 0 ? prev - 1 : 0;
      });
    }, 1000);

    idleCloseTimerRef.current = window.setTimeout(() => {
      playScannerTone(420, 120);
      powerOffLoginStage();
    }, timeoutMs);

    return () => {
      clearIdleLoginTimer();
    };
  }, [currentUser, scanSystemPoweredOn, authLoading, scanInProgress, postScanReady, loginPaused, powerOffLoginStage, clearIdleLoginTimer]);

  useEffect(() => {
    return () => {
      clearScanAnimations();
      clearIdleLoginTimer();
      clear2sTimers();
    };
  }, [clearIdleLoginTimer, clear2sTimers]);

  const getExpirySelectionForRow = (rowId) => {
    return requestExpiryMap[rowId] || {
      date: getTodayDateInputValue(),
      time: '23:59'
    };
  };

  const updateExpirySelectionForRow = (rowId, patch) => {
    setRequestExpiryMap((prev) => {
      const current = prev[rowId] || {
        date: getTodayDateInputValue(),
        time: '23:59'
      };
      return {
        ...prev,
        [rowId]: { ...current, ...patch }
      };
    });
  };

  const fetchApprovalLogs = async () => {
    setLoadingApprovalLogs(true);
    const { data, error } = await supabase
      .from('edit_audit_logs')
      .select('id, one_time_code, code_scope, used_item_ids, target_item_id, target_product_name, requested_by, requested_role, status, note, admin_username, old_values, new_values, used, used_at, expires_at, created_at')
      .order('id', { ascending: false })
      .limit(40);
    setLoadingApprovalLogs(false);

    if (!error && data) {
      setApprovalLogs(data);

      // หากเป็นฝั่ง user ให้เด้งแจ้งเตือนรหัสที่เพิ่งได้รับอนุมัติอัตโนมัติ
      if (currentUser && currentUser.role !== 'admin_shipping') {
        const newlyApproved = data.find(
          (row) =>
            row.requested_by === currentUser.username &&
            isCodeActive(row) &&
            !seenApprovedIdsRef.current.has(row.id)
        );
        if (newlyApproved) {
          seenApprovedIdsRef.current.add(newlyApproved.id);
          setLiveIssuedBanner(newlyApproved);
        }
      }
    }
  };

  useEffect(() => {
    if (!currentUser) return;
    seenApprovedIdsRef.current = new Set();
    setLiveIssuedBanner(null);
    fetchNeckTags();
    fetchApprovalLogs();

    const channel = supabase
      .channel('sanoh-edit-audit-logs')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'edit_audit_logs' },
        () => {
          fetchApprovalLogs();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUser]);

  const pendingRequests = approvalLogs.filter((row) => row.status === 'pending');
  const myRequests = approvalLogs.filter((row) => row.requested_by === currentUser?.username);

  // เข้าสู่ระบบ
  const handleLogin = async (e) => {
    e.preventDefault();
    if (!scanSystemPoweredOn) {
      showScannerToast('คลังปิดอยู่', 'กรุณากด "เปิดคลัง" และสแกนบาร์โค้ดก่อนเข้าสู่ระบบ', '⏻');
      return;
    }
    if (!scannerUnlocked) {
      showScannerToast('ระบบล็อกอยู่', 'กรุณาสแกนบาร์โค้ดค้างไว้ 2 วินาทีก่อนเข้าสู่ระบบ', '🔒');
      return;
    }
    if (!loginUsername.trim() || !loginPassword.trim()) {
      return alert('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');
    }

    setLoginPaused(true);
    window.clearTimeout(loginIdle2sTimerRef.current);
    loginIdle2sTimerRef.current = null;
    clearIdleLoginTimer();
    setAuthLoading(true);
    const { data, error } = await supabase
      .from('app_users')
      .select('id, username, full_name, role')
      .eq('username', loginUsername.trim())
      .eq('password', loginPassword)
      .maybeSingle();
    setAuthLoading(false);

    if (error) {
      alert('เกิดข้อผิดพลาดในการเข้าสู่ระบบ: ' + error.message);
      return;
    }

    if (!data) {
      alert('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
      return;
    }

    setCurrentUser(data);
    setLoginUsername('');
    setLoginPassword('');
  };

  // ลงทะเบียน Staff (เฉพาะ admin_shipping และล็อก role เป็น 'user_shipping')
  const handleRegisterStaff = async (e) => {
    e.preventDefault();
    if (!isAdmin) {
      return alert('สิทธิ์ไม่เพียงพอ: เฉพาะผู้ดูแลระบบ (admin_shipping) เท่านั้นที่สามารถลงทะเบียน Staff ได้');
    }
    if (!staffFullName.trim() || !staffUsername.trim() || !staffPassword.trim()) {
      return alert('กรุณากรอกข้อมูลให้ครบถ้วน');
    }

    setRegisteringStaff(true);
    const { data, error } = await supabase
      .from('app_users')
      .insert([
        {
          full_name: staffFullName.trim(),
          username: staffUsername.trim(),
          password: staffPassword,
          role: 'user_shipping'
        }
      ])
      .select('id, username, full_name, role')
      .single();
    setRegisteringStaff(false);

    if (error) {
      if (error.code === '23505') {
        alert('ชื่อผู้ใช้นี้ถูกใช้งานแล้ว กรุณาใช้ชื่ออื่น');
      } else {
        alert('เกิดข้อผิดพลาดในการลงทะเบียน Staff: ' + error.message);
      }
      return;
    }

    alert(`ลงทะเบียนบัญชี Staff เรียบร้อยแล้ว (${data.username} • user_shipping)`);
    setStaffFullName('');
    setStaffUsername('');
    setStaffPassword('');
    setIsRegisterModalOpen(false);
  };

  // เปิดหน้าต่างขอรหัสอนุมัติสำหรับ User
  const handleOpenRequestCodeModal = (tag) => {
    setRequestModalItem(tag);
    setRequestScope('single_item');
    setRequestNote('');
    setVerifyUsername(currentUser?.username || '');
    setVerifyPassword('');
  };

  // ส่งคำขอรหัสอนุมัติ (ถ้าขอแบบใช้ได้ทั้งวัน/หลายรายการ ต้องยืนยัน Username + Password ของผู้ขอ)
  const handleSubmitApprovalRequest = async (e) => {
    e.preventDefault();
    if (!requestModalItem || !currentUser) return;

    if (requestScope === 'daily_multi') {
      if (!verifyUsername.trim() || !verifyPassword.trim()) {
        return alert('การขอรหัสแบบใช้ได้ทั้งวัน ต้องกรอก Username และ Password เพื่อยืนยันตัวตน');
      }
      const { data: verifiedUser, error: verifyError } = await supabase
        .from('app_users')
        .select('id, username')
        .eq('username', verifyUsername.trim())
        .eq('password', verifyPassword)
        .maybeSingle();

      if (verifyError || !verifiedUser || verifiedUser.username !== currentUser.username) {
        return alert('ยืนยันตัวตนไม่สำเร็จ: ชื่อผู้ใช้หรือรหัสผ่านไม่ตรงกับบัญชีที่ล็อกอินอยู่');
      }
    }

    setSubmittingRequest(true);
    const { error } = await supabase
      .from('edit_audit_logs')
      .insert([
        {
          target_item_id: requestScope === 'daily_multi' ? 'ALL_TODAY' : String(requestModalItem.id),
          target_product_name:
            requestScope === 'daily_multi'
              ? `ขอสิทธิ์แก้หลายรายการ (เริ่มต้นที่ #${requestModalItem.id} ${requestModalItem["Product Name"] || ''})`
              : requestModalItem["Product Name"] || '-',
          requested_by: currentUser.username,
          requested_role: currentUser.role,
          code_scope: requestScope,
          used_item_ids: [],
          status: 'pending',
          note:
            requestNote.trim() ||
            (requestScope === 'daily_multi' ? 'ขอรหัสใช้ได้หลายรายการเพื่อแก้ไข' : 'ขอรหัส 1 ครั้งสำหรับแก้ไขรายการนี้'),
          used: false
        }
      ]);
    setSubmittingRequest(false);

    if (error) {
      alert('ส่งคำขอรหัสอนุมัติไม่สำเร็จ: ' + error.message);
      return;
    }

    alert('ส่งคำขอรหัสอนุมัติไปยังแอดมินแล้ว เมื่อแอดมินอนุมัติ รหัสจะเด้งขึ้นหน้าจอคุณอัตโนมัติ');
    setRequestModalItem(null);
    setRequestNote('');
    setVerifyPassword('');
    fetchApprovalLogs();
  };

  // แอดมินกดอนุมัติคำขอและสร้างรหัสอนุมัติ (ใช้วันและเวลาที่แอดมินเลือกไว้ก่อนกดอนุมัติ)
  const handleApproveRequest = async (requestRow) => {
    if (!isAdmin) return;
    setProcessingRequestId(requestRow.id);

    const scope = requestRow.code_scope === 'daily_multi' ? 'daily_multi' : 'single_item';
    const newCode = generateApprovalCode(scope);
    const selectedExpiry = getExpirySelectionForRow(requestRow.id);
    const expiresAtIso =
      scope === 'daily_multi'
        ? buildExpiryIsoFromDate(selectedExpiry.date, selectedExpiry.time)
        : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const { error } = await supabase
      .from('edit_audit_logs')
      .update({
        one_time_code: newCode,
        status: 'approved',
        admin_username: currentUser.username,
        used: false,
        expires_at: expiresAtIso
      })
      .eq('id', requestRow.id)
      .eq('status', 'pending');

    setProcessingRequestId(null);

    if (error) {
      alert('อนุมัติคำขอไม่สำเร็จ: ' + error.message);
      return;
    }

    setLatestIssuedInfo({
      code: newCode,
      scope,
      expiresAt: expiresAtIso,
      requestedBy: requestRow.requested_by || 'ผู้ขอ',
      itemId: requestRow.target_item_id || '-',
      productName: requestRow.target_product_name || '-'
    });
    fetchApprovalLogs();
  };

  // แอดมินกดหยุดการใช้งานของรหัสทันที
  const handleStopApprovalCode = async (row) => {
    if (!isAdmin || !row) return;
    if (!window.confirm(`ยืนยันหยุดการใช้งานรหัส ${row.one_time_code || `#${row.id}`} ทันที?`)) return;

    setProcessingRequestId(row.id);
    const nowIso = new Date().toISOString();
    const { error } = await supabase
      .from('edit_audit_logs')
      .update({
        used: true,
        used_at: nowIso,
        expires_at: nowIso,
        admin_username: currentUser.username
      })
      .eq('id', row.id);

    setProcessingRequestId(null);

    if (error) {
      alert('หยุดการใช้งานรหัสไม่สำเร็จ: ' + error.message);
      return;
    }

    if (liveIssuedBanner?.id === row.id) {
      setLiveIssuedBanner(null);
    }
    fetchApprovalLogs();
  };

  // แอดมินกดปฏิเสธคำขอ
  const handleRejectRequest = async (requestRow) => {
    if (!isAdmin) return;
    setProcessingRequestId(requestRow.id);

    const { error } = await supabase
      .from('edit_audit_logs')
      .update({
        status: 'rejected',
        admin_username: currentUser.username
      })
      .eq('id', requestRow.id)
      .eq('status', 'pending');

    setProcessingRequestId(null);

    if (error) {
      alert('ปฏิเสธคำขอไม่สำเร็จ: ' + error.message);
      return;
    }

    fetchApprovalLogs();
  };

  const handleOpenApprovalModal = () => {
    if (!isAdmin) return;
    setLatestIssuedInfo(null);
    setIsApprovalModalOpen(true);
    fetchApprovalLogs();
  };

  // ออกจากระบบ: กลับมาหน้าล็อกอินและคงการ์ดล็อกอินไว้ให้กรอกเปลี่ยนบัญชีได้ทันที
  const handleLogout = () => {
    setCurrentUser(null);
    localStorage.removeItem('sanoh_session_user');
    setLoginUsername('');
    setLoginPassword('');
    setIsEditModalOpen(false);
    setIsModalOpen(false);
    setIsRegisterModalOpen(false);
    setIsApprovalModalOpen(false);
    setQtyModalItem(null);
    setRequestModalItem(null);
    setMyRequestsModalOpen(false);
    setLiveIssuedBanner(null);
    powerOnLoginStage({ unlockImmediately: true, silentToast: true });
    showScannerToast(
      'ออกจากระบบแล้ว',
      'การ์ดล็อกอินเปิดพร้อมใช้งาน สามารถกรอกบัญชีเพื่อเข้าสู่ระบบต่อได้ทันที',
      '🔑'
    );
  };

  const fetchNeckTags = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('stock_neck_tags')
      .select('*')
      .order('id', { ascending: true });
    if (error) console.error('Error fetching:', error);
    else setNeckTags(data || []);
    setLoading(false);
  };

  // เพิ่มข้อมูล Neck Tag ใหม่
  const handleAddTag = async (e) => {
    e.preventDefault();
    if (!productName) return alert('กรุณากรอกชื่อผลิตภัณฑ์ (Product Name)');

    const maxId = neckTags.reduce((max, item) => {
      const currentId = parseInt(item.id, 10);
      return !isNaN(currentId) && currentId > max ? currentId : max;
    }, 0);
    const nextId = String(maxId + 1);

    const now = new Date();
    const formattedDate =
      dateIn ||
      `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}.${String(now.getMinutes()).padStart(2, '0')}.${String(now.getSeconds()).padStart(2, '0')}`;

    const { error } = await supabase.from('stock_neck_tags').insert([
      {
        id: nextId,
        "Date IN": formattedDate,
        "Product Code": productCode || '-',
        "Cutom No.": customNo || '-',
        "Ref Doc.": refDoc || '-',
        "Product Name": productName,
        "Total Qty": totalQty || '0',
        "Uom": 'CASES',
        "Total Qty_BO": totalQtyBo || '0',
        "Uom_1": 'BOTTS',
        "Price": price || '0'
      }
    ]);

    if (error) {
      alert('เกิดข้อผิดพลาดในการบันทึก: ' + error.message);
      console.error(error);
    } else {
      setDateIn('');
      setProductCode('');
      setCustomNo('');
      setRefDoc('');
      setProductName('');
      setTotalQty('');
      setTotalQtyBo('');
      setPrice('');
      setIsModalOpen(false);
      fetchNeckTags();
    }
  };

  // เปิดหน้าต่างพิมพ์จำนวนขวด / จำนวนลัง โดยตรง
  const openDirectQtyModal = (item) => {
    setQtyModalItem(item);
    setDirectBottles(String(item["Total Qty_BO"] ?? '0'));
    setDirectCases(String(item["Total Qty"] ?? '0'));
  };

  // บันทึกจำนวนขวด และ/หรือ จำนวนลัง แบบพิมพ์ตัวเลขลงไปโดยตรง
  const handleDirectQtySubmit = async (e) => {
    e.preventDefault();
    if (!qtyModalItem) return;

    const parsedBottles = Number(directBottles);
    const parsedCases = Number(directCases);

    if (directBottles === '' || Number.isNaN(parsedBottles) || parsedBottles < 0) {
      return alert('กรุณากรอกจำนวนขวดเป็นตัวเลขตั้งแต่ 0 ขึ้นไป');
    }
    if (directCases === '' || Number.isNaN(parsedCases) || parsedCases < 0) {
      return alert('กรุณากรอกจำนวนลังเป็นตัวเลขตั้งแต่ 0 ขึ้นไป');
    }

    setSavingDirectQty(true);
    const { error } = await supabase
      .from('stock_neck_tags')
      .update({
        "Total Qty_BO": String(parsedBottles),
        "Total Qty": String(parsedCases)
      })
      .eq('id', qtyModalItem.id);
    setSavingDirectQty(false);

    if (error) {
      alert('บันทึกจำนวนไม่สำเร็จ: ' + error.message);
    } else {
      setQtyModalItem(null);
      fetchNeckTags();
    }
  };

  // เปิดหน้าต่างแก้ไขรายการสินค้า (ถ้ามีรหัสอนุมัติที่ยังใช้งานได้ของตัวเอง ให้เติมอัตโนมัติให้ด้วย)
  const handleOpenEditModal = (tag) => {
    setEditingItem(tag);
    if (!isAdmin) {
      const activeDailyCode = myRequests.find(
        (r) => r.code_scope === 'daily_multi' && isCodeActive(r)
      );
      const activeSingleCode = myRequests.find(
        (r) =>
          r.code_scope !== 'daily_multi' &&
          isCodeActive(r) &&
          String(r.target_item_id) === String(tag.id)
      );
      setApprovalCodeInput(activeSingleCode?.one_time_code || activeDailyCode?.one_time_code || '');
    } else {
      setApprovalCodeInput('');
    }

    setEditProductName(tag["Product Name"] || '');
    setEditProductCode(tag["Product Code"] || '');
    setEditTotalQty(tag["Total Qty"] || '0');
    setEditTotalQtyBo(tag["Total Qty_BO"] || '0');
    setEditPrice(tag["Price"] || '0');
    setEditCustomNo(tag["Cutom No."] || '');
    setEditRefDoc(tag["Ref Doc."] || '');
    setIsEditModalOpen(true);
  };

  // บันทึกการแก้ไขรายการสินค้า (Admin แก้ได้อิสระ / User ตรวจสอบรหัส 1 รายการ หรือ รหัสตามวันที่กำหนด)
  const handleSaveEdit = async (e) => {
    e.preventDefault();
    if (!editingItem || !currentUser) return;

    if (!editProductName.trim()) {
      return alert('กรุณากรอกชื่อผลิตภัณฑ์ (Product Name)');
    }

    const qtyBoNum = parseFloat(editTotalQtyBo);
    if (!isNaN(qtyBoNum) && qtyBoNum < 0) {
      return alert('จำนวนขวดต้องไม่น้อยกว่า 0');
    }

    const oldValues = {
      "Product Name": editingItem["Product Name"] || '',
      "Product Code": editingItem["Product Code"] || '',
      "Total Qty": editingItem["Total Qty"] || '0',
      "Total Qty_BO": editingItem["Total Qty_BO"] || '0',
      "Price": editingItem["Price"] || '0',
      "Cutom No.": editingItem["Cutom No."] || '',
      "Ref Doc.": editingItem["Ref Doc."] || ''
    };

    const newValues = {
      "Product Name": editProductName.trim(),
      "Product Code": editProductCode.trim() || '-',
      "Total Qty": String(editTotalQty ?? '0'),
      "Total Qty_BO": String(editTotalQtyBo ?? '0'),
      "Price": String(editPrice ?? '0'),
      "Cutom No.": editCustomNo.trim() || '-',
      "Ref Doc.": editRefDoc.trim() || '-'
    };

    setSavingEdit(true);

    // กรณีเป็น Admin: แก้ไขได้อิสระไม่ต้องใช้รหัส และบันทึกประวัติการแก้ลง edit_audit_logs
    if (isAdmin) {
      const { error: updateError } = await supabase
        .from('stock_neck_tags')
        .update(newValues)
        .eq('id', editingItem.id);

      if (!updateError) {
        await supabase.from('edit_audit_logs').insert([
          {
            target_item_id: String(editingItem.id),
            target_product_name: editProductName.trim(),
            requested_by: currentUser.username,
            requested_role: currentUser.role,
            admin_username: currentUser.username,
            code_scope: 'admin_free',
            status: 'approved',
            note: 'Admin แก้ไขโดยตรง (ไม่ต้องใช้รหัส)',
            old_values: oldValues,
            new_values: newValues,
            used: true,
            used_at: new Date().toISOString()
          }
        ]);
      }

      setSavingEdit(false);
      if (updateError) {
        alert('เกิดข้อผิดพลาดในการแก้ไขข้อมูล: ' + updateError.message);
      } else {
        setIsEditModalOpen(false);
        setEditingItem(null);
        fetchNeckTags();
        fetchApprovalLogs();
      }
      return;
    }

    // กรณีเป็น User: ต้องกรอกรหัสอนุมัติที่ได้รับอนุมัติ ถูกเปิดใช้งานอยู่ และยังไม่หมดเวลา
    const normalizedCode = approvalCodeInput.trim().toUpperCase();
    if (!normalizedCode) {
      setSavingEdit(false);
      return alert('กรุณากรอกรหัสอนุมัติ (Approval Code) ที่ได้รับจากแอดมิน');
    }

    const { data: codeRecord, error: lookupError } = await supabase
      .from('edit_audit_logs')
      .select('id, one_time_code, code_scope, used_item_ids, target_item_id, status, used, expires_at')
      .eq('one_time_code', normalizedCode)
      .maybeSingle();

    if (lookupError || !codeRecord) {
      setSavingEdit(false);
      alert('ไม่พบรหัสอนุมัตินี้ในระบบ กรุณาตรวจสอบรหัสอีกครั้ง');
      return;
    }

    if (codeRecord.status !== 'approved' || codeRecord.used) {
      setSavingEdit(false);
      alert('รหัสอนุมัตินี้ถูกหยุดใช้งาน ใช้ครบตามสิทธิ์ หรือยังไม่ได้รับการอนุมัติ');
      return;
    }

    if (codeRecord.expires_at && new Date(codeRecord.expires_at).getTime() <= Date.now()) {
      setSavingEdit(false);
      alert('รหัสอนุมัตินี้หมดอายุแล้ว กรุณาขอรหัสอนุมัติใหม่');
      return;
    }

    const isDailyMulti = codeRecord.code_scope === 'daily_multi';

    // ถ้าเป็นรหัสแบบ 1 รหัสต่อ 1 รายการ ให้ตรวจว่าตรงกับรายการที่ขอไว้หรือไม่
    if (!isDailyMulti && codeRecord.target_item_id && String(codeRecord.target_item_id) !== String(editingItem.id)) {
      setSavingEdit(false);
      alert(`รหัสนี้ระบุไว้สำหรับแก้ไขรายการ #${codeRecord.target_item_id} เท่านั้น`);
      return;
    }

    const currentUsedIds = Array.isArray(codeRecord.used_item_ids) ? codeRecord.used_item_ids : [];
    const nextUsedIds = Array.from(new Set([...currentUsedIds, String(editingItem.id)]));

    const logUpdatePayload = isDailyMulti
      ? {
          used_at: new Date().toISOString(),
          target_product_name: editProductName.trim(),
          used_item_ids: nextUsedIds,
          old_values: oldValues,
          new_values: newValues
        }
      : {
          used: true,
          used_at: new Date().toISOString(),
          target_item_id: String(editingItem.id),
          target_product_name: editProductName.trim(),
          used_item_ids: nextUsedIds,
          old_values: oldValues,
          new_values: newValues
        };

    const { data: consumedRows, error: consumeError } = await supabase
      .from('edit_audit_logs')
      .update(logUpdatePayload)
      .eq('id', codeRecord.id)
      .eq('used', false)
      .select('id');

    if (consumeError || !consumedRows || consumedRows.length === 0) {
      setSavingEdit(false);
      alert('ไม่สามารถยืนยันรหัสอนุมัติได้ อาจถูกหยุดใช้งานหรือใช้งานไปแล้ว');
      return;
    }

    const { error: updateError } = await supabase
      .from('stock_neck_tags')
      .update(newValues)
      .eq('id', editingItem.id);

    setSavingEdit(false);

    if (updateError) {
      alert('เกิดข้อผิดพลาดในการแก้ไขข้อมูล: ' + updateError.message);
      console.error(updateError);
    } else {
      if (!isDailyMulti) setApprovalCodeInput('');
      setIsEditModalOpen(false);
      setEditingItem(null);
      fetchNeckTags();
      fetchApprovalLogs();
    }
  };

  // เพิ่ม/ลดจำนวนขวด (+/-)
  const handleUpdateStock = async (id, newQty) => {
    if (newQty < 0) return;
    const { error } = await supabase
      .from('stock_neck_tags')
      .update({ "Total Qty_BO": String(newQty) })
      .eq('id', id);
    if (error) alert('เกิดข้อผิดพลาดในการอัปเดต: ' + error.message);
    else fetchNeckTags();
  };

  // ลบรายการ (จำกัดสิทธิ์เฉพาะ admin_shipping)
  const handleDeleteTag = async (id, name) => {
    if (!isAdmin) {
      return alert('สิทธิ์ไม่เพียงพอ: การลบรายการสินค้าสงวนไว้สำหรับผู้ดูแลระบบ (admin_shipping) เท่านั้น');
    }
    if (!window.confirm(`ยืนยันการลบรายการ "${name}" ออกจากระบบ?`)) return;
    const { error } = await supabase
      .from('stock_neck_tags')
      .delete()
      .eq('id', id);
    if (error) alert('เกิดข้อผิดพลาดในการลบ: ' + error.message);
    else fetchNeckTags();
  };

  // ส่งออกข้อมูลเป็น CSV
  const handleExportCSV = () => {
    const headers = ['id,Date IN,Product Code,Cutom No.,Ref Doc.,Product Name,Total Qty,Uom,Total Qty_BO,Uom_1,Price'];
    const rows = neckTags.map(t =>
      `"${t.id || ''}","${t["Date IN"] || ''}","${t["Product Code"] || ''}","${t["Cutom No."] || ''}","${t["Ref Doc."] || ''}","${t["Product Name"] || ''}","${t["Total Qty"] || '0'}","${t["Uom"] || 'CASES'}","${t["Total Qty_BO"] || '0'}","${t["Uom_1"] || 'BOTTS'}","${t["Price"] || '0'}"`
    );
    const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + [headers, ...rows].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `sanoh_stock_neck_tags_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // --- หน้า Warehouse Scanner Login ---
  if (!currentUser) {
    const sweepY = 272 + (sweepPercent / 100) * 32;
    const showCountdownNumber =
      scanSystemPoweredOn && !scanInProgress && !(postScanReady && loginPaused) && countdownSeconds !== null;

    return (
      <div className="min-h-screen bg-[#050403] text-stone-100 flex flex-col justify-between relative overflow-x-hidden selection:bg-orange-500 selection:text-stone-950">
        {/* Background Ambient Warm Orange Glow */}
        <div
          className={`fixed inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-orange-950/35 via-[#060504] to-black pointer-events-none transition-opacity duration-700 z-0 ${
            warehouseLightsOn ? 'opacity-100' : 'opacity-20'
          }`}
        />
        <div
          className={`fixed top-1/3 left-1/4 -translate-x-1/2 -translate-y-1/2 w-[680px] h-[680px] bg-orange-500/15 rounded-full blur-[150px] pointer-events-none transition-opacity duration-700 z-0 ${
            warehouseLightsOn ? 'opacity-100' : 'opacity-0'
          }`}
        />

        {/* Toast Notification */}
        {scannerToast && (
          <div className="fixed top-5 left-1/2 -translate-x-1/2 z-50 min-w-[320px] max-w-lg bg-[#100c09]/95 backdrop-blur-md border border-orange-500/30 text-stone-100 px-5 py-3.5 rounded-2xl shadow-2xl flex items-center gap-3.5">
            <div className="w-9 h-9 rounded-xl bg-orange-500/20 text-orange-400 flex items-center justify-center shrink-0 font-bold">
              {scannerToast.icon}
            </div>
            <div className="text-xs sm:text-sm">
              <p className="font-bold text-stone-100">{scannerToast.title}</p>
              <p className="text-stone-400 text-xs">{scannerToast.msg}</p>
            </div>
          </div>
        )}

        {/* Top Header */}
        <header className="relative z-20 w-full max-w-7xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-orange-500 via-amber-500 to-orange-600 p-0.5 shadow-lg shadow-orange-500/25">
              <div className="w-full h-full bg-[#060504] rounded-[14px] flex items-center justify-center text-orange-400">
                <Package size={22} />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-black tracking-wider bg-gradient-to-r from-stone-100 via-orange-200 to-orange-400 bg-clip-text text-transparent">
                  SANOH NECK TAG
                </span>
                <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-orange-500/20 text-orange-300 border border-orange-500/30 rounded-md">
                  WMS v4.5
                </span>
              </div>
              <p className="text-[11px] text-stone-400 font-medium">
                ระบบจัดการสต็อก Neck Tag & คลังพัสดุ
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setAudioMuted((m) => !m)}
              className="w-10 h-10 rounded-xl bg-[#100c09] border border-stone-800 hover:border-orange-500/40 text-stone-400 hover:text-orange-300 flex items-center justify-center transition-all shadow-md cursor-pointer"
              title="เปิด/ปิดเสียงสแกนเนอร์"
            >
              {audioMuted ? <VolumeX size={18} className="text-stone-500" /> : <Volume2 size={18} className="text-orange-400" />}
            </button>

            <div
              className={`flex items-center gap-2.5 px-3.5 py-2 rounded-xl border text-xs font-mono font-semibold shadow-md ${
                !scanSystemPoweredOn
                  ? 'bg-stone-900/90 border-stone-700 text-stone-400'
                  : scannerUnlocked
                  ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-300'
                  : 'bg-[#100c09]/90 border-amber-500/30 text-amber-400'
              }`}
            >
              <span className="relative flex h-2.5 w-2.5">
                {scanSystemPoweredOn && !scannerUnlocked && (
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                )}
                <span
                  className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                    !scanSystemPoweredOn ? 'bg-stone-500' : scannerUnlocked ? 'bg-emerald-400' : 'bg-amber-500'
                  }`}
                />
              </span>
              <span className="tracking-wide">
                {!scanSystemPoweredOn ? 'SYS: OFF' : scannerUnlocked ? 'SYS: ONLINE' : 'SYS: LOCKED'}
              </span>
            </div>
          </div>
        </header>

        {/* Main Grid */}
        <main className="relative z-10 w-full max-w-7xl mx-auto px-4 sm:px-6 py-4 flex-1 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-center">
          {/* Left Stage: Warehouse Stage */}
          <section
            className={`${
              scanSystemPoweredOn ? 'lg:col-span-7' : 'lg:col-span-12'
            } flex flex-col items-center justify-center relative min-h-[480px] sm:min-h-[540px] rounded-3xl border p-4 sm:p-6 overflow-hidden select-none transition-all duration-500 ${
              warehouseLightsOn
                ? 'bg-[#060504]/60 border-orange-500/15'
                : 'bg-[#030202]/90 border-stone-800/80'
            }`}
          >
            {/* Guidance Banner */}
            {scanSystemPoweredOn && !scannerUnlocked && (
              <div className="mb-2 z-20 bg-orange-500/10 border border-orange-500/35 text-orange-300 font-medium text-xs px-4 py-2 rounded-xl backdrop-blur-md flex items-center gap-2 animate-bounce">
                <span>🎯 ลาก <b>เครื่องสแกน</b> ไปทาบที่แถบบาร์โค้ดบนกล่องค้างไว้ <b>2 วินาที</b></span>
              </div>
            )}

            {/* Telemetry Panel */}
            <div className="absolute top-4 left-4 z-10 font-mono text-[11px] text-stone-400 bg-[#100c09]/85 backdrop-blur-md border border-stone-800 rounded-xl p-3 space-y-1 shadow-lg hidden sm:block">
              <div className="flex items-center gap-2">
                <span className="text-stone-500">SCAN_POWER:</span>
                <span className={scanSystemPoweredOn ? 'text-emerald-400 font-bold' : 'text-stone-500 font-bold'}>
                  {scanSystemPoweredOn ? 'ON' : 'OFF'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-stone-500">WAREHOUSE_LIGHT:</span>
                <span className={warehouseLightsOn ? 'text-orange-400 font-bold' : 'text-stone-500 font-bold'}>
                  {warehouseLightsOn ? 'ON' : 'OFF'}
                </span>
              </div>
            </div>

            {/* Scanning Floating HUD */}
            {scanSystemPoweredOn && isScanningHold && (
              <div className="mb-1 z-30 bg-[#100c09]/95 border border-orange-500/40 text-orange-400 font-mono text-xs px-4 py-2 rounded-2xl backdrop-blur-md shadow-2xl flex items-center gap-3">
                <div className="flex items-center gap-1.5 font-bold">
                  <span className="inline-block w-2.5 h-2.5 rounded-full bg-orange-400 animate-ping" />
                  <span>SCANNING BARCODE...</span>
                </div>
                <div className="w-24 h-2 bg-stone-800 rounded-full overflow-hidden border border-stone-700">
                  <div
                    className="h-full bg-gradient-to-r from-orange-500 to-emerald-400 transition-all duration-75"
                    style={{ width: `${scanProgress}%` }}
                  />
                </div>
                <span className="font-extrabold text-orange-300 w-9 text-right">{scanProgress}%</span>
              </div>
            )}

            {/* Warehouse SVG Stage */}
            <div className="relative w-full max-w-[580px] h-[360px] sm:h-[400px] flex items-center justify-center">
              <svg
                ref={svgStageRef}
                className="w-full h-full overflow-visible touch-none select-none"
                viewBox="0 0 600 420"
              >
                <defs>
                  <radialGradient id="spotCoreGlow1" cx="50%" cy="0%" r="85%">
                    <stop offset="0%" stopColor="#fff7ed" stopOpacity="0.95" />
                    <stop offset="28%" stopColor="#fb923c" stopOpacity="0.65" />
                    <stop offset="68%" stopColor="#ea580c" stopOpacity="0.22" />
                    <stop offset="100%" stopColor="#c2410c" stopOpacity="0" />
                  </radialGradient>

                  <radialGradient id="spotCoreGlow2" cx="50%" cy="0%" r="85%">
                    <stop offset="0%" stopColor="#fff7ed" stopOpacity="0.95" />
                    <stop offset="28%" stopColor="#f97316" stopOpacity="0.65" />
                    <stop offset="68%" stopColor="#ea580c" stopOpacity="0.22" />
                    <stop offset="100%" stopColor="#c2410c" stopOpacity="0" />
                  </radialGradient>

                  <linearGradient id="metalDarkGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#332922" />
                    <stop offset="50%" stopColor="#1c1612" />
                    <stop offset="100%" stopColor="#0c0907" />
                  </linearGradient>

                  <linearGradient id="cardboardGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#d97706" />
                    <stop offset="60%" stopColor="#b45309" />
                    <stop offset="100%" stopColor="#78350f" />
                  </linearGradient>
                </defs>

                {/* 1. Spotlights (เปิด/ปิดตามไฟคลังสินค้า) */}
                <g className={`transition-opacity duration-500 pointer-events-none ${warehouseLightsOn ? 'opacity-100' : 'opacity-0'}`}>
                  <polygon points="150,45 210,45 345,372 15,372" fill="url(#spotCoreGlow1)" />
                  <ellipse cx="180" cy="366" rx="155" ry="20" fill="#fb923c" fillOpacity="0.16" />
                </g>

                <g className={`transition-opacity duration-500 pointer-events-none ${warehouseLightsOn ? 'opacity-100' : 'opacity-0'}`}>
                  <polygon points="410,45 470,45 585,372 295,372" fill="url(#spotCoreGlow2)" />
                  <ellipse cx="440" cy="366" rx="145" ry="20" fill="#f97316" fillOpacity="0.16" />
                </g>

                {/* Ceiling Truss */}
                <line x1="20" y1="20" x2="580" y2="20" stroke="#29201a" strokeWidth="6" strokeLinecap="round" />
                <line x1="20" y1="20" x2="580" y2="20" stroke="#44352b" strokeWidth="2" strokeDasharray="12 8" />

                {/* Spotlight Fixtures */}
                <g>
                  <line x1="180" y1="20" x2="180" y2="35" stroke="#57463a" strokeWidth="4" />
                  <path d="M 160 35 L 200 35 L 215 50 L 145 50 Z" fill="url(#metalDarkGrad)" stroke="#57463a" strokeWidth="1.5" />
                  <ellipse cx="180" cy="50" rx="30" ry="5" fill={warehouseLightsOn ? '#fff7ed' : '#292524'} />
                </g>

                <g>
                  <line x1="440" y1="20" x2="440" y2="35" stroke="#57463a" strokeWidth="4" />
                  <path d="M 420 35 L 460 35 L 475 50 L 405 50 Z" fill="url(#metalDarkGrad)" stroke="#57463a" strokeWidth="1.5" />
                  <ellipse cx="440" cy="50" rx="30" ry="5" fill={warehouseLightsOn ? '#fff7ed' : '#292524'} />
                </g>

                {/* 2. Scanner Dock Cradle */}
                <g>
                  <rect x="50" y="270" width="45" height="55" rx="8" fill="url(#metalDarkGrad)" stroke="#3f3127" strokeWidth="2" />
                  <rect x="58" y="260" width="29" height="15" rx="4" fill="#120d0a" stroke="#57463a" />
                  <circle cx="72" cy="300" r="4" fill={scanSystemPoweredOn ? '#f97316' : '#57534e'} />
                  <text x="72.5" y="316" fontFamily="monospace" fontSize="6" fill="#78716c" textAnchor="middle">DOCK</text>
                </g>

                {/* 3. Conveyor Belt */}
                <g>
                  <rect x="130" y="315" width="440" height="36" rx="8" fill="#140f0c" stroke="#29201a" strokeWidth="3" />
                  <rect x="140" y="319" width="420" height="14" rx="4" fill="#070504" />
                  <line
                    x1="142"
                    y1="326"
                    x2="558"
                    y2="326"
                    stroke={scanSystemPoweredOn && warehouseLightsOn ? '#f97316' : '#44352b'}
                    strokeWidth="4"
                    strokeDasharray="8 16"
                  />
                  <g>
                    <circle cx="170" cy="340" r="8" fill="#29201a" stroke="#57463a" strokeWidth="2" />
                    <circle cx="250" cy="340" r="8" fill="#29201a" stroke="#57463a" strokeWidth="2" />
                    <circle cx="330" cy="340" r="8" fill="#29201a" stroke="#57463a" strokeWidth="2" />
                    <circle cx="410" cy="340" r="8" fill="#29201a" stroke="#57463a" strokeWidth="2" />
                    <circle cx="490" cy="340" r="8" fill="#29201a" stroke="#57463a" strokeWidth="2" />
                  </g>
                  <rect x="180" y="351" width="14" height="40" fill="#29201a" rx="2" />
                  <rect x="350" y="351" width="14" height="40" fill="#29201a" rx="2" />
                  <rect x="510" y="351" width="14" height="40" fill="#29201a" rx="2" />
                </g>

                {/* 4. Cargo Box & Barcode Target */}
                <g opacity={scanSystemPoweredOn ? 1 : 0.45}>
                  <ellipse cx="280" cy="320" rx="50" ry="7" fill="#000000" fillOpacity="0.65" />
                  <rect x="230" y="215" width="100" height="100" rx="8" fill="url(#cardboardGrad)" stroke="#78350f" strokeWidth="2" />
                  <line x1="280" y1="215" x2="280" y2="315" stroke="#92400e" strokeWidth="3" />
                  <rect x="228" y="260" width="104" height="12" fill="#b45309" opacity="0.6" />

                  <rect x="240" y="228" width="20" height="22" rx="3" fill="#fffbeb" />
                  <path d="M 250 233 L 245 241 L 248 241 L 248 246 L 252 246 L 252 241 L 255 241 Z" fill="#dc2626" />

                  <g ref={barcodeTargetRef}>
                    <rect x="240" y="270" width="80" height="36" rx="5" fill="#ffffff" stroke="#fde68a" strokeWidth="2" />
                    <g fill="#1c1917">
                      <rect x="246" y="274" width="3" height="20" />
                      <rect x="251" y="274" width="1" height="20" />
                      <rect x="254" y="274" width="4" height="20" />
                      <rect x="260" y="274" width="2" height="20" />
                      <rect x="264" y="274" width="1" height="20" />
                      <rect x="267" y="274" width="5" height="20" />
                      <rect x="274" y="274" width="2" height="20" />
                      <rect x="278" y="274" width="1" height="20" />
                      <rect x="281" y="274" width="4" height="20" />
                      <rect x="287" y="274" width="2" height="20" />
                      <rect x="291" y="274" width="3" height="20" />
                      <rect x="296" y="274" width="1" height="20" />
                      <rect x="299" y="274" width="5" height="20" />
                      <rect x="306" y="274" width="2" height="20" />
                      <rect x="310" y="274" width="3" height="20" />
                    </g>
                    <text x="280" y="300" fontFamily="monospace" fontSize="5.5" fontWeight="bold" fill="#1c1917" textAnchor="middle">
                      WMS-8829-4012
                    </text>
                  </g>

                  {scanSystemPoweredOn && isScanningHold && (
                    <line
                      x1="242"
                      y1={sweepY}
                      x2="318"
                      y2={sweepY}
                      stroke="#ef4444"
                      strokeWidth="2.5"
                    />
                  )}

                  {scanSystemPoweredOn && (
                    <rect x="236" y="266" width="88" height="44" rx="8" fill="none" stroke="#f97316" strokeWidth="2" strokeDasharray="4 4" className="animate-pulse" />
                  )}
                </g>

                {/* 5. Draggable Scanner (รองรับทั้งเมาส์และทัชสกรีนมือถือโดยไม่เลื่อนหน้าจอ) */}
                <g
                  ref={scannerGroupRef}
                  className="touch-none select-none"
                  onPointerDown={handleScannerPointerDown}
                  onPointerMove={handleScannerPointerMove}
                  onPointerUp={handleScannerPointerUp}
                  onPointerCancel={handleScannerPointerUp}
                  onTouchStart={handleScannerTouchStart}
                  onTouchMove={handleScannerTouchMove}
                  onTouchEnd={handleScannerTouchEnd}
                  onTouchCancel={handleScannerTouchEnd}
                  opacity={scanSystemPoweredOn ? 1 : 0.45}
                  style={{
                    touchAction: 'none',
                    WebkitUserSelect: 'none',
                    userSelect: 'none',
                    cursor: !scanSystemPoweredOn || scannerUnlocked ? 'not-allowed' : 'grab'
                  }}
                >
                  <path d="M 72 260 Q 60 230 72 200" fill="none" stroke="#44352b" strokeWidth="3" strokeDasharray="4 4" />
                  <rect x="58" y="195" width="26" height="50" rx="6" fill="#1c1917" stroke={scanSystemPoweredOn ? '#f97316' : '#57534e'} strokeWidth="2" transform="rotate(15, 71, 220)" />
                  <rect x="74" y="205" width="6" height="14" rx="2" fill={scanSystemPoweredOn ? '#f97316' : '#57534e'} />
                  <path d="M 43 180 C 43 162, 97 162, 97 180 L 92 202 L 48 202 Z" fill={scanSystemPoweredOn ? '#f97316' : '#57534e'} stroke={scanSystemPoweredOn ? '#ea580c' : '#44403c'} strokeWidth="2" />
                  <rect x="50" y="168" width="40" height="5" rx="2" fill="#0c0a09" />
                  <rect x="50" y="175" width="40" height="22" rx="3" fill="#090706" stroke="#44352b" strokeWidth="1.2" />
                  <rect x="52" y="177" width="36" height="18" rx="2" fill={scanSystemPoweredOn && isScanningHold ? '#7f1d1d' : '#1c1917'} />
                  <text x="70" y="185.5" fontFamily="monospace" fontSize="5.5" fontWeight="bold" fill="#ffffff" textAnchor="middle">
                    {scannerReadout.screenTop}
                  </text>
                  <text x="70" y="192.5" fontFamily="monospace" fontSize="4.8" fontWeight="bold" fill="#fdba74" textAnchor="middle">
                    {scannerReadout.screenBottom}
                  </text>
                </g>
              </svg>
            </div>

            {/* สวิตช์เปิด-ปิดคลัง */}
            <div className="mt-2 flex items-center justify-center z-10">
              <button
                type="button"
                onClick={handleToggleScanPower}
                className={`px-6 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center gap-2 cursor-pointer border shadow-lg ${
                  scanSystemPoweredOn
                    ? 'bg-rose-600 hover:bg-rose-500 text-white border-rose-400 shadow-rose-950/40'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-400 shadow-emerald-950/40'
                }`}
              >
                <Power size={16} />
                <span>{scanSystemPoweredOn ? 'ปิดคลัง' : 'เปิดคลัง'}</span>
              </button>
            </div>
          </section>

          {/* Pop-up Industrial Computer Monitor Overlay */}
          {monitorOpen && (
            <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[92%] max-w-lg bg-[#100c09] border-4 border-orange-500/40 rounded-3xl p-5 shadow-2xl">
              <div className="flex items-center justify-between pb-3 mb-3 border-b border-stone-800">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-rose-500" />
                  <div className="w-3 h-3 rounded-full bg-amber-500" />
                  <div className="w-3 h-3 rounded-full bg-emerald-500" />
                  <span className="font-mono text-xs text-stone-400 font-bold ml-2">
                    INDUSTRIAL TERMINAL POS v2.4
                  </span>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-orange-500/20 text-orange-300 font-bold">
                  ONLINE
                </span>
              </div>

              <div className="bg-black border border-orange-500/40 rounded-2xl p-5 font-mono text-xs sm:text-sm text-orange-400 space-y-3 min-h-[180px]">
                <div className="flex items-center gap-2 text-stone-400 border-b border-orange-950/80 pb-2">
                  <span>&gt; SCANNER INPUT PORT:</span>
                  <span className="text-orange-300 font-bold">[COM3_BARCODE]</span>
                </div>
                <div>
                  <span className="text-stone-400">STATUS: </span>
                  <span className="text-amber-400 font-bold">{scannerReadout.terminalStatus}</span>
                </div>
                <div className="p-3 bg-orange-950/35 border border-orange-500/30 rounded-xl flex items-center justify-between">
                  <span className="text-stone-400">BARCODE:</span>
                  <span className="text-lg sm:text-xl font-extrabold text-orange-300 tracking-wider font-mono min-h-[28px]">
                    {scannerReadout.barcodeText}
                  </span>
                </div>
                <div className="text-xs text-stone-300 pt-1 font-mono">
                  {scannerReadout.log}
                </div>
              </div>

              <div className="text-center pt-3 text-[11px] font-mono text-stone-500">
                SANOH NECK TAG INDUSTRIAL CONTROLLER
              </div>
            </div>
          )}

          {/* Right Stage: Login Form Card (ซ่อนเมื่อปิดระบบสแกน และแสดงเมื่อเปิดระบบสแกน) */}
          {scanSystemPoweredOn && (
            <section className="lg:col-span-5 flex flex-col items-center">
              <div className="w-full max-w-md flex flex-col">
                {/* ตัวเลขนับถอยหลังมุมขวาเหนือการ์ดล็อกอิน ขนาดกำลังดี สีจาง ไม่มีพื้นหลัง */}
                <div className="h-6 mb-1.5 pr-1 flex items-center justify-end">
                  {showCountdownNumber && (
                    <span className="text-stone-400/65 font-mono font-semibold text-lg leading-none tracking-wider select-none">
                      {countdownSeconds}
                    </span>
                  )}
                </div>

                <div
                  onPointerDown={touchLoginActivity}
                  className={`w-full bg-[#100c09]/95 backdrop-blur-xl border border-orange-500/25 rounded-3xl p-6 sm:p-8 shadow-2xl relative overflow-hidden transition-all duration-500 ${
                    scannerUnlocked ? 'opacity-100 translate-y-0' : 'opacity-80 translate-y-2'
                  }`}
                >
                  <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-orange-600 via-orange-400 to-amber-400" />

                  {!scannerUnlocked && (
                    <div className="absolute inset-0 bg-[#060504]/90 backdrop-blur-md z-30 flex flex-col items-center justify-center p-6 text-center">
                      <div className="w-14 h-14 rounded-2xl bg-orange-500/15 border border-orange-500/35 text-orange-400 flex items-center justify-center mb-4 shadow-lg shadow-orange-500/15 animate-bounce">
                        <Lock size={26} />
                      </div>
                      <h3 className="text-lg font-bold text-stone-100 mb-1">ระบบคลังสินค้าล็อกอยู่</h3>
                      <p className="text-xs text-stone-400 max-w-xs">
                        ลาก <b>เครื่องสแกนไปทาบที่</b> แถบบาร์โค้ดบนกล่องพัสดุค้างไว้ <b>2 วินาที</b> เพื่อปลดล็อกเข้าสู่ระบบ
                      </p>
                    </div>
                  )}

                  <div className="mb-6">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] font-mono font-bold tracking-wider text-orange-400 uppercase">
                        SANOH NECK TAG LOGIN
                      </span>
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold border ${
                          scannerUnlocked
                            ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                            : 'bg-amber-500/15 text-amber-400 border-amber-500/25'
                        }`}
                      >
                        {scannerUnlocked ? 'UNLOCKED' : 'LOCKED'}
                      </span>
                    </div>
                    <h2 className="text-2xl font-extrabold text-stone-100 tracking-tight">
                      เข้าสู่ระบบจัดการสต็อก
                    </h2>
                    <p className="text-xs text-stone-400 mt-1">
                      บัญชีผู้ใช้งานถูกจัดการโดยผู้ดูแลระบบ (Admin)
                    </p>
                  </div>

                  <form onSubmit={handleLogin} className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-stone-300 mb-1.5">
                        ชื่อผู้ใช้ (Username)
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="admin_sanoh หรือ staff_sanoh"
                        value={loginUsername}
                        onFocus={touchLoginActivity}
                        onChange={(e) => {
                          touchLoginActivity();
                          setLoginUsername(e.target.value);
                        }}
                        className="w-full bg-[#060504] border border-stone-800 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 text-stone-100 placeholder-stone-600 rounded-xl px-4 py-2.5 text-xs sm:text-sm font-mono outline-none transition-all"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="block text-xs font-semibold text-stone-300">
                          รหัสผ่าน (Password)
                        </label>
                        <button
                          type="button"
                          onClick={() =>
                            showScannerToast(
                              'ลืมรหัสผ่าน?',
                              'กรุณาติดต่อ Admin ผู้ดูแลระบบเพื่อรีเซ็ตหรือลงทะเบียนบัญชี',
                              'ℹ'
                            )
                          }
                          className="text-xs font-medium text-orange-400 hover:text-orange-300 hover:underline cursor-pointer"
                        >
                          ลืมรหัสผ่าน?
                        </button>
                      </div>
                      <div className="relative">
                        <input
                          type={showLoginPassword ? 'text' : 'password'}
                          required
                          placeholder="••••••••"
                          value={loginPassword}
                          onFocus={touchLoginActivity}
                          onChange={(e) => {
                            touchLoginActivity();
                            setLoginPassword(e.target.value);
                          }}
                          className="w-full bg-[#060504] border border-stone-800 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 text-stone-100 placeholder-stone-600 rounded-xl px-4 pr-10 py-2.5 text-xs sm:text-sm outline-none transition-all"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            touchLoginActivity();
                            setShowLoginPassword((s) => !s);
                          }}
                          className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-stone-500 hover:text-orange-400 transition-colors cursor-pointer"
                        >
                          {showLoginPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={authLoading || !scannerUnlocked}
                      className="w-full bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-stone-950 font-bold py-2.5 rounded-xl text-sm shadow-lg shadow-orange-500/25 transition-all cursor-pointer"
                    >
                      {authLoading ? 'กำลังตรวจสอบ...' : 'เข้าสู่ระบบ'}
                    </button>
                  </form>
                </div>
              </div>
            </section>
          )}
        </main>
      </div>
    );
  }

  // คำนวณสถิติรวม
  const totalBottles = neckTags.reduce((sum, item) => sum + (parseFloat(item["Total Qty_BO"]) || 0), 0);
  const totalCases = neckTags.reduce((sum, item) => sum + (parseFloat(item["Total Qty"]) || 0), 0);
  const totalStockValue = neckTags.reduce((sum, item) => {
    const qty = parseFloat(item["Total Qty_BO"]) || 0;
    const unitPrice = parseFloat(item["Price"]) || 0;
    return sum + (qty * unitPrice);
  }, 0);

  const lowStockItems = neckTags.filter(item => (parseFloat(item["Total Qty_BO"]) || 0) <= 5);

  // ระบบค้นหาแบบยืดหยุ่น
  const filteredTags = neckTags.filter((item) => {
    if (!searchTerm.trim()) return true;
    const searchableText = [
      item.id,
      item["Product Name"],
      item["Product Code"],
      item["Ref Doc."],
      item["Cutom No."],
      item["Date IN"]
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    const keywords = searchTerm.toLowerCase().trim().split(/\s+/);
    return keywords.every((word) => searchableText.includes(word));
  });

  const activeUserCodesCount = myRequests.filter((r) => isCodeActive(r)).length;

  return (
    <div className="min-h-screen bg-[#050403] text-stone-100 font-sans relative overflow-x-hidden selection:bg-orange-500 selection:text-stone-950">
      {/* Background Ambient Warm Orange Glow */}
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-orange-950/35 via-[#060504] to-black pointer-events-none z-0" />
      <div className="fixed top-1/4 left-1/4 -translate-x-1/2 -translate-y-1/2 w-[640px] h-[640px] bg-orange-500/12 rounded-full blur-[150px] pointer-events-none z-0" />

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 py-6">

        {/* แบนเนอร์แจ้งเตือนคำขอรหัสอนุมัติ สำหรับ Admin */}
        {isAdmin && pendingRequests.length > 0 && (
          <div className="mb-5 bg-[#1a120b] border-2 border-amber-400/70 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xl shadow-amber-950/30">
            <div className="flex items-start sm:items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-400/20 border border-amber-400/60 flex items-center justify-center text-amber-300 shrink-0 animate-pulse">
                <Bell size={20} />
              </div>
              <div>
                <p className="text-sm font-bold text-amber-200">
                  แจ้งเตือน: มีคำขอรหัสอนุมัติแก้ไขข้อมูลค้างอยู่ {pendingRequests.length} รายการ
                </p>
                <p className="text-xs text-stone-300 mt-0.5">
                  ผู้ขอ: <span className="font-bold text-white">{pendingRequests[0].requested_by}</span> • {pendingRequests[0].code_scope === 'daily_multi' ? 'ขอรหัสใช้หลายรายการ (เลือกวันก่อนอนุมัติได้)' : `รายการ #${pendingRequests[0].target_item_id}`}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleOpenApprovalModal}
              className="px-4 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-stone-950 font-extrabold text-xs whitespace-nowrap transition cursor-pointer shrink-0 shadow-md shadow-amber-500/25"
            >
              ตรวจสอบและออกรหัส ({pendingRequests.length})
            </button>
          </div>
        )}

        {/* แบนเนอร์เด้งอัตโนมัติฝั่ง User เมื่อแอดมินอนุมัติรหัสให้แล้ว */}
        {!isAdmin && liveIssuedBanner && isCodeActive(liveIssuedBanner) && (
          <div className="mb-5 bg-[#0c1a14] border-2 border-emerald-400/70 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xl">
            <div>
              <p className="text-xs font-bold text-emerald-300">
                ได้รับรหัสอนุมัติแก้ไขอัตโนมัติ ({liveIssuedBanner.code_scope === 'daily_multi' ? `ใช้ได้ถึง ${formatThaiDateTime(liveIssuedBanner.expires_at)}` : `สำหรับรายการ #${liveIssuedBanner.target_item_id} เท่านั้น`})
              </p>
              <p className="font-mono font-extrabold text-white text-base mt-1">{liveIssuedBanner.one_time_code}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setApprovalCodeInput(liveIssuedBanner.one_time_code);
                  setMyRequestsModalOpen(true);
                }}
                className="px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-stone-950 font-extrabold text-xs cursor-pointer"
              >
                ดูรหัสของฉัน
              </button>
              <button
                type="button"
                onClick={() => setLiveIssuedBanner(null)}
                className="p-2 rounded-xl bg-stone-900 border border-stone-700 text-stone-200 hover:bg-stone-800 cursor-pointer"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        )}

        {/* Header */}
        <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-6 border-b border-orange-500/25">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-orange-500 via-amber-500 to-orange-600 p-0.5 shadow-lg shadow-orange-500/25">
              <div className="w-full h-full bg-[#080604] rounded-[14px] flex items-center justify-center overflow-hidden p-1">
                <img
                  src="/logo.png"
                  alt="Sanoh Logo"
                  className="w-full h-full object-contain"
                  onError={(e) => {
                    e.target.style.display = 'none';
                    e.target.nextSibling.style.display = 'flex';
                  }}
                />
                <div className="w-full h-full items-center justify-center text-orange-400 hidden">
                  <Package size={26} />
                </div>
              </div>
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-mono font-bold tracking-wider text-orange-400 uppercase">
                  SANOH ANGLO-THAI SHIPPING
                </span>
                <span className={`px-2.5 py-0.5 text-[11px] font-mono font-bold rounded-full flex items-center gap-1 border ${
                  isAdmin
                    ? 'bg-orange-500/20 text-orange-200 border-orange-400/50'
                    : 'bg-amber-500/20 text-amber-200 border-amber-400/50'
                }`}>
                  {isAdmin ? <ShieldCheck size={12} /> : <UserCheck size={12} />}
                  {currentUser.role} ({currentUser.full_name})
                </span>
              </div>
              <h1 className="text-xl sm:text-2xl font-extrabold text-white mt-0.5">
                บริษัท เสนาะ แองโกลไทย ชิปปิ้ง บริการ จำกัด
              </h1>
              <p className="text-xs text-stone-300">
                ระบบบริหารจัดการสต็อกคอขวด (Neck Tag) และมูลค่าสุรานำเข้าต่างประเทศ
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {isAdmin ? (
              <>
                <button
                  type="button"
                  onClick={handleOpenApprovalModal}
                  className={`relative font-bold px-3.5 py-2.5 rounded-xl text-sm transition flex items-center gap-2 cursor-pointer border-2 shadow-md ${
                    pendingRequests.length > 0
                      ? 'bg-amber-500/25 hover:bg-amber-500/35 text-amber-100 border-amber-400'
                      : 'bg-[#1c140d] hover:bg-[#271c12] text-amber-300 border-amber-500/50'
                  }`}
                >
                  <Bell size={16} className="text-amber-300" />
                  <span>คำขอรหัส & Log</span>
                  {pendingRequests.length > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-rose-600 text-white text-[11px] font-extrabold">
                      {pendingRequests.length}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setIsRegisterModalOpen(true)}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-3.5 py-2.5 rounded-xl text-sm transition flex items-center gap-1.5 cursor-pointer border border-emerald-400/60 shadow-md shadow-emerald-950/40"
                >
                  <UserPlus size={16} /> ลงทะเบียน Staff
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => {
                  fetchApprovalLogs();
                  setMyRequestsModalOpen(true);
                }}
                className="bg-[#1c140d] hover:bg-[#271c12] text-amber-200 border-2 border-amber-500/50 font-bold px-3.5 py-2.5 rounded-xl text-sm transition flex items-center gap-1.5 cursor-pointer shadow-md"
              >
                <KeyRound size={16} className="text-amber-300" /> รหัสที่ขอ ({activeUserCodesCount} พร้อมใช้)
              </button>
            )}

            <button
              type="button"
              onClick={() => setIsModalOpen(true)}
              className="bg-orange-500 hover:bg-orange-400 text-stone-950 font-extrabold px-4 py-2.5 rounded-xl text-sm transition shadow-lg shadow-orange-500/30 flex items-center gap-2 cursor-pointer border border-orange-300"
            >
              <Plus size={18} strokeWidth={2.5} /> เพิ่มรายการ Neck Tag
            </button>

            <button
              type="button"
              onClick={handleExportCSV}
              className="bg-stone-800 hover:bg-stone-700 text-white border border-stone-500 font-bold px-4 py-2.5 rounded-xl text-sm transition flex items-center gap-2 cursor-pointer shadow-md"
            >
              <Download size={16} className="text-orange-400" /> Export CSV
            </button>

            <button
              type="button"
              onClick={handleLogout}
              className="bg-rose-950/85 hover:bg-rose-900 text-rose-100 border border-rose-500/60 font-bold px-3.5 py-2.5 rounded-xl text-sm transition flex items-center gap-1.5 cursor-pointer shadow-md"
              title="ออกจากระบบ"
            >
              <LogOut size={16} className="text-rose-300" /> ออก
            </button>
          </div>
        </header>

        {/* แถบเมนูนำทาง */}
        <div className="flex flex-wrap items-center justify-between gap-3 my-6">
          <div className="flex items-center gap-2.5 bg-[#0c0907] p-1.5 rounded-2xl border border-stone-800">
            <button
              type="button"
              onClick={() => setActiveTab('dashboard')}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition flex items-center gap-2 cursor-pointer border ${
                activeTab === 'dashboard'
                  ? 'bg-orange-500 text-stone-950 border-orange-300 shadow-md shadow-orange-500/25'
                  : 'bg-[#16110d] text-stone-300 border-stone-700/80 hover:border-orange-500/50 hover:text-white'
              }`}
            >
              <TrendingUp size={16} /> ภาพรวมสต็อก (Dashboard)
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('inventory')}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition flex items-center gap-2 cursor-pointer border ${
                activeTab === 'inventory'
                  ? 'bg-orange-500 text-stone-950 border-orange-300 shadow-md shadow-orange-500/25'
                  : 'bg-[#16110d] text-stone-300 border-stone-700/80 hover:border-orange-500/50 hover:text-white'
              }`}
            >
              <Package size={16} /> รายการ Neck Tag ทั้งหมด ({neckTags.length})
            </button>
          </div>

          {!isAdmin && (
            <div className="text-xs text-stone-200 bg-[#16110d] border border-orange-500/40 px-3.5 py-2 rounded-xl flex items-center gap-1.5 shadow-sm">
              <Lock size={13} className="text-orange-400 shrink-0" />
              <span>สิทธิ์ <strong className="text-white">user_shipping</strong>: กรอกยอด/ปรับสต็อกได้ทันที และกด <strong className="text-orange-300">ขอรหัส</strong> ก่อนแก้ไขข้อมูลหลัก</span>
            </div>
          )}
        </div>

        {/* การ์ดสรุปข้อมูล 4 ช่อง */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-[#16110d] border border-orange-500/35 rounded-2xl p-5 shadow-xl">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs font-bold text-orange-300">จำนวนขวด / Cases รวม</p>
                <h3 className="text-2xl font-extrabold text-white mt-2">
                  {totalBottles.toLocaleString()} <span className="text-sm font-normal text-stone-300">ขวด</span>
                </h3>
              </div>
              <div className="p-2.5 bg-orange-500/20 rounded-xl text-orange-300 border border-orange-400/40">
                <TrendingUp size={20} />
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-stone-700/80 flex justify-between text-xs text-stone-300">
              <span>จำนวนลังรวมทั้งหมด</span>
              <span className="text-amber-300 font-bold">{totalCases.toLocaleString()} Cases</span>
            </div>
          </div>

          <div className="bg-[#16110d] border border-emerald-500/35 rounded-2xl p-5 shadow-xl">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs font-bold text-emerald-300">มูลค่าสินค้าในคลังรวม</p>
                <h3 className="text-2xl font-extrabold text-white mt-2">
                  ฿{totalStockValue.toLocaleString()}
                </h3>
              </div>
              <div className="p-2.5 bg-emerald-500/20 rounded-xl text-emerald-300 border border-emerald-400/40">
                <DollarSign size={20} />
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-stone-700/80 flex justify-between text-xs text-stone-300">
              <span>คำนวณจากราคา × จำนวนขวด</span>
              <span className="text-emerald-300 font-bold">THB</span>
            </div>
          </div>

          <div className="bg-[#16110d] border border-orange-500/35 rounded-2xl p-5 shadow-xl">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs font-bold text-stone-300">รายการทั้งหมด</p>
                <div className="flex items-baseline gap-2 mt-2">
                  <h3 className="text-2xl font-extrabold text-white">
                    {neckTags.length.toLocaleString()}
                  </h3>
                  <span className="text-sm text-stone-300">รายการ</span>
                </div>
              </div>
              <div className="p-2.5 bg-[#0b0806] rounded-xl text-orange-300 border border-orange-500/30">
                <Layers size={20} />
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-stone-700/80 flex justify-between text-xs text-stone-300">
              <span>ฐานข้อมูล Supabase</span>
              <span className="text-orange-300 font-bold">Active</span>
            </div>
          </div>

          <div className={`border rounded-2xl p-5 transition shadow-xl ${
            lowStockItems.length > 0 ? 'bg-rose-950/45 border-rose-500/60' : 'bg-[#16110d] border-orange-500/35'
          }`}>
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs font-bold text-stone-300">เตือนสต็อกต่ำกว่า 5 ขวด</p>
                <div className="flex items-baseline gap-2 mt-2">
                  <h3 className={`text-2xl font-extrabold ${lowStockItems.length > 0 ? 'text-rose-300' : 'text-white'}`}>
                    {lowStockItems.length}
                  </h3>
                  <span className="text-sm text-stone-300">รายการ</span>
                </div>
              </div>
              <div className={`p-2.5 rounded-xl border ${
                lowStockItems.length > 0 ? 'bg-rose-500/20 text-rose-300 border-rose-400/50' : 'bg-[#0b0806] text-stone-300 border-stone-700'
              }`}>
                <AlertTriangle size={20} />
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-stone-700/80 flex justify-between text-xs">
              <span className="text-stone-300">สถานะการจัดการ</span>
              <span className={lowStockItems.length > 0 ? 'text-rose-300 font-bold' : 'text-emerald-300 font-bold'}>
                {lowStockItems.length > 0 ? 'ควรตรวจสอบสต็อก' : 'ปกติ'}
              </span>
            </div>
          </div>
        </div>

        {/* ส่วนเนื้อหาหลัก */}
        {activeTab === 'dashboard' ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

            {/* รายการสต็อกต่ำ */}
            <div className="lg:col-span-5 bg-[#16110d] border border-orange-500/35 rounded-2xl p-5 flex flex-col shadow-xl">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={18} className="text-orange-400" />
                  <h2 className="font-bold text-white text-sm">รายการสต็อกน้อย (Low Stock)</h2>
                </div>
                <span className="px-2.5 py-0.5 text-xs font-mono font-bold bg-orange-500/20 text-orange-200 border border-orange-400/50 rounded-full">
                  {lowStockItems.length} Items
                </span>
              </div>

              {lowStockItems.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center py-10 text-center border border-dashed border-stone-700 rounded-xl bg-[#0d0a08]">
                  <CheckCircle2 size={32} className="text-orange-400/60 mb-2" />
                  <p className="text-sm text-stone-300">ไม่มีรายการสต็อกต่ำกว่าเกณฑ์</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
                  {lowStockItems.map((item) => (
                    <div key={item.id} className="bg-[#0d0a08] border border-stone-700/90 hover:border-orange-400/60 rounded-xl p-3.5 flex items-center justify-between gap-3 transition">
                      <div>
                        <p className="text-sm font-bold text-white">{item["Product Name"]}</p>
                        <p className="text-xs text-stone-300 mt-1">
                          รหัส: {item["Product Code"]} | คงเหลือ: <span className="text-rose-300 font-bold">{item["Total Qty_BO"]} ขวด</span> ({item["Total Qty"] || 0} Cases)
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleUpdateStock(item.id, (parseFloat(item["Total Qty_BO"]) || 0) + 10)}
                        className="px-3 py-1.5 bg-orange-500 hover:bg-orange-400 text-stone-950 border border-orange-300 rounded-xl text-xs font-extrabold transition whitespace-nowrap cursor-pointer shadow-sm"
                      >
                        + เติม 10
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* รายการ Neck Tag ล่าสุด */}
            <div className="lg:col-span-7 bg-[#16110d] border border-orange-500/35 rounded-2xl p-5 shadow-xl">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Package size={18} className="text-orange-400" />
                  <h2 className="font-bold text-white text-sm">รายการคอขวด (Neck Tag) ล่าสุด</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('inventory')}
                  className="px-3 py-1 rounded-lg bg-orange-500/20 hover:bg-orange-500/30 border border-orange-400/50 text-xs font-bold text-orange-200 cursor-pointer transition"
                >
                  ดูทั้งหมด →
                </button>
              </div>

              <div className="space-y-2.5">
                {neckTags.slice(0, 6).map((item) => {
                  const qtyBo = parseFloat(item["Total Qty_BO"]) || 0;
                  const unitPrice = parseFloat(item["Price"]) || 0;
                  return (
                    <div key={item.id} className="p-3 rounded-xl bg-[#0d0a08] border border-stone-800 hover:border-orange-500/40 flex items-center justify-between gap-3 transition">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-white truncate">{item["Product Name"]}</p>
                        <p className="text-xs text-stone-300 mt-0.5">
                          #{item.id} • {item["Product Code"]} • {item["Date IN"] || '-'}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-extrabold text-orange-300">{qtyBo.toLocaleString()} ขวด</p>
                        <p className="text-xs font-semibold text-emerald-300">฿{(qtyBo * unitPrice).toLocaleString()}</p>
                      </div>
                    </div>
                  );
                })}
                {neckTags.length === 0 && !loading && (
                  <p className="py-8 text-center text-xs text-stone-300">ยังไม่มีข้อมูลในตาราง stock_neck_tags</p>
                )}
              </div>
            </div>
          </div>
        ) : (
          /* ตารางรายการ Neck Tag ทั้งหมด */
          <div className="bg-[#16110d] border border-orange-500/35 rounded-2xl p-5 shadow-xl">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <h2 className="font-bold text-white text-sm">รายการสต็อกคอขวด (Neck Tag) ทั้งหมด</h2>
              <div className="relative w-full sm:w-80">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-orange-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="ค้นหาชื่อสินค้า, รหัส, เลขที่ใบขน, วันที่..."
                  className="w-full bg-[#080604] border border-stone-600 focus:border-orange-400 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-stone-400 outline-none transition"
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-separate border-spacing-y-2 text-xs">
                <thead>
                  <tr className="text-orange-200 bg-[#211811]">
                    <th className="py-3 px-3 rounded-l-xl font-bold">ID</th>
                    <th className="py-3 px-2 font-bold">วันที่รับเข้า</th>
                    <th className="py-3 px-2 font-bold">ชื่อผลิตภัณฑ์ / รหัส</th>
                    <th className="py-3 px-2 text-right font-bold">Cases</th>
                    <th className="py-3 px-2 text-center font-bold">จำนวนขวด</th>
                    <th className="py-3 px-2 text-right font-bold">ราคา/ขวด</th>
                    <th className="py-3 px-2 text-right font-bold">มูลค่ารวม</th>
                    <th className="py-3 px-3 rounded-r-xl text-center font-bold">จัดการ</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTags.map((item) => {
                    const qtyBo = parseFloat(item["Total Qty_BO"]) || 0;
                    const unitPrice = parseFloat(item["Price"]) || 0;
                    return (
                      <tr
                        key={item.id}
                        className="bg-[#0d0a08] hover:bg-[#1e150e] transition shadow-sm"
                      >
                        <td className="py-3.5 px-3 rounded-l-xl border-y border-l border-stone-700/80 font-mono font-bold text-orange-300">
                          {item.id}
                        </td>
                        <td className="py-3.5 px-2 border-y border-stone-700/80 text-stone-200 whitespace-nowrap">
                          {item["Date IN"] || '-'}
                        </td>
                        <td className="py-3.5 px-2 border-y border-stone-700/80">
                          <p className="font-bold text-white text-[13px]">{item["Product Name"]}</p>
                          <p className="text-[11px] text-stone-300 mt-0.5">
                            Code: <span className="text-orange-200">{item["Product Code"]}</span> | Custom: {item["Cutom No."]} | Ref: {item["Ref Doc."]}
                          </p>
                        </td>
                        <td className="py-3.5 px-2 border-y border-stone-700/80 text-right text-amber-300 font-extrabold text-[13px]">
                          {item["Total Qty"] || 0}
                        </td>
                        <td className="py-3.5 px-2 border-y border-stone-700/80">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleUpdateStock(item.id, qtyBo - 1)}
                              className="w-7 h-7 rounded-lg bg-stone-800 hover:bg-orange-500 text-white hover:text-stone-950 border border-stone-600 hover:border-orange-300 font-extrabold cursor-pointer transition flex items-center justify-center"
                            >
                              -
                            </button>
                            <span className="min-w-[46px] text-center font-extrabold text-white text-[13px] bg-[#16110d] border border-stone-700 rounded-lg py-1 px-1.5">
                              {qtyBo.toLocaleString()}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleUpdateStock(item.id, qtyBo + 1)}
                              className="w-7 h-7 rounded-lg bg-stone-800 hover:bg-orange-500 text-white hover:text-stone-950 border border-stone-600 hover:border-orange-300 font-extrabold cursor-pointer transition flex items-center justify-center"
                            >
                              +
                            </button>
                          </div>
                        </td>
                        <td className="py-3.5 px-2 border-y border-stone-700/80 text-right text-stone-200 font-medium">
                          ฿{unitPrice.toLocaleString()}
                        </td>
                        <td className="py-3.5 px-2 border-y border-stone-700/80 text-right text-emerald-300 font-extrabold text-[13px]">
                          ฿{(qtyBo * unitPrice).toLocaleString()}
                        </td>
                        <td className="py-3.5 px-3 rounded-r-xl border-y border-r border-stone-700/80">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => openDirectQtyModal(item)}
                              className="px-2.5 py-1.5 rounded-lg bg-sky-600/25 hover:bg-sky-500/40 text-sky-200 border border-sky-400/60 text-[11px] font-bold flex items-center gap-1 cursor-pointer transition"
                              title="พิมพ์จำนวนขวดและจำนวนลังโดยตรง"
                            >
                              <SlidersHorizontal size={12} className="text-sky-300" /> กรอกยอด
                            </button>

                            {!isAdmin && (
                              <button
                                type="button"
                                onClick={() => handleOpenRequestCodeModal(item)}
                                className="px-2.5 py-1.5 rounded-lg bg-amber-500/25 hover:bg-amber-500/40 text-amber-200 border border-amber-400/60 text-[11px] font-bold flex items-center gap-1 cursor-pointer transition"
                                title="ส่งคำขอรหัสอนุมัติไปยังแอดมิน"
                              >
                                <Bell size={12} className="text-amber-300" /> ขอแก้
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => handleOpenEditModal(item)}
                              className="p-1.5 rounded-lg bg-amber-500/25 hover:bg-amber-500/40 text-amber-200 border border-amber-400/60 cursor-pointer transition"
                              title={isAdmin ? 'แก้ไขรายการได้ทันที' : 'แก้ไขรายการ (ต้องใช้รหัสอนุมัติ)'}
                            >
                              <Pencil size={14} className="text-amber-300" />
                            </button>

                            {isAdmin && (
                              <button
                                type="button"
                                onClick={() => handleDeleteTag(item.id, item["Product Name"])}
                                className="p-1.5 rounded-lg bg-rose-600/25 hover:bg-rose-600/45 text-rose-200 border border-rose-400/60 cursor-pointer transition"
                                title="ลบรายการ"
                              >
                                <Trash2 size={14} className="text-rose-300" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Modal สำหรับ User: ส่งคำขอรหัสอนุมัติ (1 รายการ หรือ ใช้ได้หลายรายการ + ยืนยันตัวตน) */}
        {requestModalItem && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-[#16110d] border border-orange-500/40 rounded-3xl p-6 shadow-2xl">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Bell size={18} className="text-orange-400" />
                  <h3 className="font-bold text-white text-base">ขอรหัสอนุมัติแก้ไข #{requestModalItem.id}</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setRequestModalItem(null)}
                  className="text-stone-300 hover:text-white cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>
              <p className="text-xs text-stone-300 mb-4 truncate">{requestModalItem["Product Name"]}</p>

              <form onSubmit={handleSubmitApprovalRequest} className="space-y-3 text-xs">
                <div>
                  <label className="block text-stone-200 font-semibold mb-1.5">รูปแบบรหัสที่ต้องการขอ</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setRequestScope('single_item')}
                      className={`p-2.5 rounded-xl border text-left transition cursor-pointer ${
                        requestScope === 'single_item'
                          ? 'bg-orange-500/25 border-orange-400 text-orange-100 font-bold'
                          : 'bg-[#0d0a08] border-stone-700 text-stone-300'
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <KeyRound size={13} /> 1 รหัส / 1 รายการ
                      </div>
                      <p className="text-[10px] opacity-85 mt-0.5">ใช้แก้รายการนี้ 1 ครั้ง</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setRequestScope('daily_multi')}
                      className={`p-2.5 rounded-xl border text-left transition cursor-pointer ${
                        requestScope === 'daily_multi'
                          ? 'bg-amber-500/25 border-amber-400 text-amber-100 font-bold'
                          : 'bg-[#0d0a08] border-stone-700 text-stone-300'
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <CalendarDays size={13} /> หลายรายการ (กำหนดวัน)
                      </div>
                      <p className="text-[10px] opacity-85 mt-0.5">ต้องยืนยันตัวตนผู้ขอ</p>
                    </button>
                  </div>
                </div>

                {requestScope === 'daily_multi' && (
                  <div className="p-3 rounded-xl bg-orange-500/15 border border-orange-400/40 space-y-2.5">
                    <p className="text-[11px] font-bold text-orange-200">
                      ยืนยันตัวตนผู้ขอรหัสแบบหลายรายการ (Username & Password)
                    </p>
                    <div>
                      <label className="block text-stone-200 mb-1">Username ผู้ขอ</label>
                      <input
                        type="text"
                        required
                        value={verifyUsername}
                        onChange={(e) => setVerifyUsername(e.target.value)}
                        className="w-full bg-[#080604] border border-stone-600 rounded-xl p-2 text-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-stone-200 mb-1">Password ผู้ขอ</label>
                      <input
                        type="password"
                        required
                        placeholder="กรอกรหัสผ่านเพื่อยืนยันตัวตน"
                        value={verifyPassword}
                        onChange={(e) => setVerifyPassword(e.target.value)}
                        className="w-full bg-[#080604] border border-stone-600 rounded-xl p-2 text-white"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-stone-200 font-semibold mb-1">เหตุผลที่ขอแก้ไข (แจ้งให้แอดมินเห็น)</label>
                  <input
                    type="text"
                    required
                    placeholder="เช่น แก้ไขราคาต่อขวด หรือเลขที่ใบขนให้ตรงเอกสาร"
                    value={requestNote}
                    onChange={(e) => setRequestNote(e.target.value)}
                    className="w-full bg-[#080604] border border-stone-600 rounded-xl p-2.5 text-white focus:outline-none focus:border-orange-400"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setRequestModalItem(null)}
                    className="px-4 py-2 rounded-xl bg-stone-800 border border-stone-600 text-white font-semibold cursor-pointer"
                  >
                    ยกเลิก
                  </button>
                  <button
                    type="submit"
                    disabled={submittingRequest}
                    className="px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-stone-950 font-extrabold cursor-pointer"
                  >
                    {submittingRequest ? 'กำลังส่งคำขอ...' : 'ส่งคำขอไปที่แอดมิน'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal สำหรับ User: ดูรายการคำขอและรหัสอนุมัติที่ได้รับ */}
        {myRequestsModalOpen && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="w-full max-w-lg bg-[#16110d] border border-orange-500/40 rounded-3xl p-6 shadow-2xl">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-white text-base">สถานะคำขอรหัสอนุมัติของฉัน</h3>
                <button
                  type="button"
                  onClick={() => setMyRequestsModalOpen(false)}
                  className="text-stone-300 hover:text-white cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="max-h-72 overflow-y-auto space-y-2.5 text-xs">
                {myRequests.length === 0 ? (
                  <p className="text-center text-stone-300 py-6">ยังไม่มีคำขอรหัสอนุมัติ</p>
                ) : (
                  myRequests.map((row) => {
                    const active = isCodeActive(row);
                    return (
                      <div key={row.id} className="p-3 rounded-xl bg-[#0d0a08] border border-stone-700 flex items-center justify-between gap-3">
                        <div>
                          <p className="font-bold text-white">
                            {row.code_scope === 'daily_multi' ? 'รหัสแก้ไขหลายรายการ' : `รายการ #${row.target_item_id || '-'} • ${row.target_product_name || '-'}`}
                          </p>
                          <p className="text-[11px] text-stone-300 mt-0.5">
                            {row.note || '-'}
                            {row.code_scope === 'daily_multi' && row.expires_at ? ` • หมดอายุ: ${formatThaiDateTime(row.expires_at)}` : ''}
                          </p>
                          {row.status === 'approved' && row.one_time_code && (
                            <p className={`font-mono font-bold mt-1 ${active ? 'text-emerald-300' : 'text-rose-300'}`}>
                              รหัส: {row.one_time_code} {active ? '(พร้อมใช้)' : '(หยุดใช้ / หมดอายุ / ใช้ครบแล้ว)'}
                            </p>
                          )}
                        </div>
                        <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border shrink-0 ${
                          active
                            ? 'bg-emerald-500/20 text-emerald-200 border-emerald-400/50'
                            : row.status === 'rejected' || (row.status === 'approved' && !active)
                            ? 'bg-rose-500/20 text-rose-200 border-rose-400/50'
                            : 'bg-amber-500/20 text-amber-200 border-amber-400/50'
                        }`}>
                          {row.status === 'approved' ? (active ? 'อนุมัติแล้ว' : 'ปิดใช้งาน') : row.status === 'rejected' ? 'ถูกปฏิเสธ' : 'รออนุมัติ'}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}

        {/* Modal: แจ้งเตือนคำขอรหัสอนุมัติ เลือกวันหมดอายุก่อนอนุมัติ หยุดรหัส และประวัติการแก้ไข (สำหรับ Admin) */}
        {isApprovalModalOpen && isAdmin && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="w-full max-w-2xl bg-[#16110d] border border-orange-500/40 rounded-3xl p-6 shadow-2xl">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <ClipboardCheck size={18} className="text-orange-400" />
                  <h3 className="font-bold text-white text-base">คำขอรหัสอนุมัติ & ประวัติการแก้ไข</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setIsApprovalModalOpen(false)}
                  className="text-stone-300 hover:text-white cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              {latestIssuedInfo && (
                <div className="mb-4 p-3.5 rounded-xl bg-emerald-950/70 border border-emerald-400/60 text-xs">
                  <p className="text-emerald-200 font-bold">
                    ออกรหัส ({latestIssuedInfo.scope === 'daily_multi' ? `ใช้ได้ถึง ${formatThaiDateTime(latestIssuedInfo.expiresAt)}` : '1 รหัส / 1 รายการ'}) ให้ <span className="underline">{latestIssuedInfo.requestedBy}</span>
                  </p>
                  <p className="font-mono font-extrabold text-white text-base mt-1">{latestIssuedInfo.code}</p>
                </div>
              )}

              <div className="max-h-96 overflow-y-auto border border-stone-700 rounded-2xl divide-y divide-stone-800 text-xs">
                {loadingApprovalLogs ? (
                  <p className="p-4 text-center text-stone-300">กำลังโหลดข้อมูล...</p>
                ) : approvalLogs.length === 0 ? (
                  <p className="p-4 text-center text-stone-300">ยังไม่มีรายการคำขอหรือประวัติการแก้ไข</p>
                ) : (
                  approvalLogs.map((row) => {
                    const active = isCodeActive(row);
                    const expirySel = getExpirySelectionForRow(row.id);

                    return (
                      <div key={row.id} className="p-3.5 bg-[#0d0a08] flex flex-col gap-3">
                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                                row.status === 'pending'
                                  ? 'bg-amber-500/25 text-amber-200 border-amber-400/60'
                                  : active
                                  ? 'bg-emerald-500/20 text-emerald-200 border-emerald-400/50'
                                  : 'bg-rose-500/20 text-rose-200 border-rose-400/50'
                              }`}>
                                {row.status === 'pending' ? 'รออนุมัติ' : active ? 'กำลังใช้งานได้' : row.status === 'rejected' ? 'ปฏิเสธ' : 'หยุดใช้ / หมดเวลา'}
                              </span>
                              <span className="px-2 py-0.5 rounded bg-stone-800 border border-stone-600 text-stone-200 text-[10px] font-semibold">
                                {row.code_scope === 'daily_multi' ? 'หลายรายการ' : row.code_scope === 'admin_free' ? 'Admin แก้ตรง' : '1 รายการ'}
                              </span>
                              <span className="font-bold text-white">
                                รายการ #{row.target_item_id || '-'} • {row.target_product_name || '-'}
                              </span>
                            </div>
                            <p className="text-[11px] text-stone-300">
                              ผู้ดำเนินการ: <span className="text-white font-semibold">{row.requested_by || '-'}</span> • {row.note || '-'}
                              {row.code_scope === 'daily_multi' && row.expires_at ? ` • หมดอายุ: ${formatThaiDateTime(row.expires_at)}` : ''}
                            </p>
                            {row.one_time_code && (
                              <p className="font-mono text-[11px] font-bold text-orange-300">
                                รหัส: {row.one_time_code} {active ? '(ใช้งานได้)' : '(ปิดใช้งานแล้ว)'}
                              </p>
                            )}
                          </div>

                          {active && (
                            <button
                              type="button"
                              disabled={processingRequestId === row.id}
                              onClick={() => handleStopApprovalCode(row)}
                              className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-bold flex items-center gap-1 cursor-pointer shrink-0 border border-rose-400/60"
                              title="หยุดการใช้งานรหัสนี้ทันที"
                            >
                              <StopCircle size={14} /> หยุดใช้รหัส
                            </button>
                          )}
                        </div>

                        {row.status === 'pending' && (
                          <div className="pt-2.5 border-t border-stone-800 flex flex-wrap items-center justify-between gap-2">
                            {row.code_scope === 'daily_multi' ? (
                              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                                <span className="text-orange-200 font-semibold flex items-center gap-1">
                                  <Calendar size={13} /> ใช้งานได้ถึงวันที่:
                                </span>
                                <input
                                  type="date"
                                  value={expirySel.date}
                                  onChange={(e) => updateExpirySelectionForRow(row.id, { date: e.target.value })}
                                  className="bg-[#16110d] border border-stone-600 rounded-lg px-2 py-1 text-white focus:outline-none focus:border-orange-400"
                                />
                                <input
                                  type="time"
                                  value={expirySel.time}
                                  onChange={(e) => updateExpirySelectionForRow(row.id, { time: e.target.value })}
                                  className="bg-[#16110d] border border-stone-600 rounded-lg px-2 py-1 text-white focus:outline-none focus:border-orange-400"
                                />
                              </div>
                            ) : (
                              <span className="text-[11px] text-stone-300">รหัสแบบ 1 รายการ (ใช้ได้ 1 ครั้ง)</span>
                            )}

                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                disabled={processingRequestId === row.id}
                                onClick={() => handleApproveRequest(row)}
                                className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold flex items-center gap-1 cursor-pointer border border-emerald-400/60"
                              >
                                <Check size={14} /> อนุมัติ
                              </button>
                              <button
                                type="button"
                                disabled={processingRequestId === row.id}
                                onClick={() => handleRejectRequest(row)}
                                className="px-3 py-1.5 rounded-xl bg-rose-950 hover:bg-rose-900 text-rose-200 border border-rose-500/60 font-bold flex items-center gap-1 cursor-pointer"
                              >
                                <Ban size={14} /> ปฏิเสธ
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}

        {/* Modal: พิมพ์จำนวนขวด และ/หรือ จำนวนลัง โดยตรง */}
        {qtyModalItem && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="w-full max-w-sm bg-[#16110d] border border-orange-500/40 rounded-3xl p-6 shadow-2xl">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-white text-base">กรอกจำนวนสต็อก #{qtyModalItem.id}</h3>
                <button
                  type="button"
                  onClick={() => setQtyModalItem(null)}
                  className="text-stone-300 hover:text-white cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>
              <p className="text-xs text-stone-300 mb-4 truncate">{qtyModalItem["Product Name"]}</p>

              <form onSubmit={handleDirectQtySubmit} className="space-y-3 text-xs">
                <div>
                  <label className="block text-stone-200 font-semibold mb-1">จำนวนขวดทั้งหมด (Total Qty_BO)</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    required
                    value={directBottles}
                    onChange={(e) => setDirectBottles(e.target.value)}
                    className="w-full bg-[#080604] border border-stone-600 rounded-xl p-2.5 text-white focus:outline-none focus:border-orange-400"
                  />
                </div>
                <div>
                  <label className="block text-stone-200 font-semibold mb-1">จำนวนลังทั้งหมด (Total Qty)</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    required
                    value={directCases}
                    onChange={(e) => setDirectCases(e.target.value)}
                    className="w-full bg-[#080604] border border-stone-600 rounded-xl p-2.5 text-white focus:outline-none focus:border-orange-400"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-3">
                  <button
                    type="button"
                    onClick={() => setQtyModalItem(null)}
                    className="px-4 py-2 rounded-xl bg-stone-800 border border-stone-600 text-white font-semibold cursor-pointer"
                  >
                    ยกเลิก
                  </button>
                  <button
                    type="submit"
                    disabled={savingDirectQty}
                    className="px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-stone-950 font-extrabold cursor-pointer"
                  >
                    {savingDirectQty ? 'กำลังบันทึก...' : 'บันทึกยอด'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal: ลงทะเบียน Staff */}
        {isRegisterModalOpen && isAdmin && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-[#16110d] border border-orange-500/40 rounded-3xl p-6 shadow-2xl">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <UserPlus size={18} className="text-emerald-400" />
                  <h3 className="font-bold text-white text-base">ลงทะเบียนบัญชีพนักงาน (Staff)</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setIsRegisterModalOpen(false)}
                  className="text-stone-300 hover:text-white cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <p className="text-xs text-stone-300 mb-4">
                สิทธิ์ที่ได้รับอัตโนมัติ: <span className="text-orange-300 font-bold">user_shipping</span>
              </p>

              <form onSubmit={handleRegisterStaff} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-stone-200 mb-1">ชื่อ-นามสกุล / แผนก</label>
                  <input
                    type="text"
                    required
                    placeholder="เช่น สมชาย คลังสินค้า"
                    value={staffFullName}
                    onChange={(e) => setStaffFullName(e.target.value)}
                    className="w-full bg-[#080604] border border-stone-600 rounded-xl p-2.5 text-sm text-white focus:outline-none focus:border-orange-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-stone-200 mb-1">ชื่อผู้ใช้ (Username)</label>
                  <input
                    type="text"
                    required
                    placeholder="ตั้งชื่อผู้ใช้สำหรับ Staff"
                    value={staffUsername}
                    onChange={(e) => setStaffUsername(e.target.value)}
                    className="w-full bg-[#080604] border border-stone-600 rounded-xl p-2.5 text-sm text-white font-mono focus:outline-none focus:border-orange-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-stone-200 mb-1">รหัสผ่าน (Password)</label>
                  <input
                    type="password"
                    required
                    placeholder="ตั้งรหัสผ่าน"
                    value={staffPassword}
                    onChange={(e) => setStaffPassword(e.target.value)}
                    className="w-full bg-[#080604] border border-stone-600 rounded-xl p-2.5 text-sm text-white focus:outline-none focus:border-orange-400"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsRegisterModalOpen(false)}
                    className="px-4 py-2 rounded-xl bg-stone-800 border border-stone-600 text-xs text-white font-semibold cursor-pointer"
                  >
                    ยกเลิก
                  </button>
                  <button
                    type="submit"
                    disabled={registeringStaff}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-xs font-bold text-white cursor-pointer border border-emerald-400/60"
                  >
                    {registeringStaff ? 'กำลังบันทึก...' : 'ยืนยันลงทะเบียน Staff'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal: เพิ่มรายการ Neck Tag ใหม่ */}
        {isModalOpen && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="w-full max-w-lg bg-[#16110d] border border-orange-500/40 rounded-3xl p-6 shadow-2xl">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-white text-base">เพิ่มรายการ Neck Tag</h3>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="text-stone-300 hover:text-white cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>
              <form onSubmit={handleAddTag} className="space-y-3 text-xs">
                <div>
                  <label className="block text-stone-200 font-semibold mb-1">ชื่อผลิตภัณฑ์ (Product Name) *</label>
                  <input
                    type="text"
                    required
                    value={productName}
                    onChange={(e) => setProductName(e.target.value)}
                    className="w-full bg-[#080604] border border-stone-600 focus:border-orange-400 rounded-xl p-2.5 text-white outline-none"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-stone-200 font-semibold mb-1">Product Code</label>
                    <input
                      type="text"
                      value={productCode}
                      onChange={(e) => setProductCode(e.target.value)}
                      className="w-full bg-[#080604] border border-stone-600 focus:border-orange-400 rounded-xl p-2.5 text-white outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-stone-200 font-semibold mb-1">วันที่รับเข้า (Date IN)</label>
                    <input
                      type="text"
                      placeholder="เว้นว่างเพื่อใช้เวลาปัจจุบัน"
                      value={dateIn}
                      onChange={(e) => setDateIn(e.target.value)}
                      className="w-full bg-[#080604] border border-stone-600 focus:border-orange-400 rounded-xl p-2.5 text-white outline-none"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-stone-200 font-semibold mb-1">จำนวนลัง (Cases)</label>
                    <input
                      type="number"
                      step="any"
                      value={totalQty}
                      onChange={(e) => setTotalQty(e.target.value)}
                      className="w-full bg-[#080604] border border-stone-600 focus:border-orange-400 rounded-xl p-2.5 text-white outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-stone-200 font-semibold mb-1">จำนวนขวด (Total Qty_BO)</label>
                    <input
                      type="number"
                      step="any"
                      value={totalQtyBo}
                      onChange={(e) => setTotalQtyBo(e.target.value)}
                      className="w-full bg-[#080604] border border-stone-600 focus:border-orange-400 rounded-xl p-2.5 text-white outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-stone-200 font-semibold mb-1">ราคาต่อขวด (บาท)</label>
                    <input
                      type="number"
                      step="any"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      className="w-full bg-[#080604] border border-stone-600 focus:border-orange-400 rounded-xl p-2.5 text-white outline-none"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-stone-200 font-semibold mb-1">Custom No.</label>
                    <input
                      type="text"
                      value={customNo}
                      onChange={(e) => setCustomNo(e.target.value)}
                      className="w-full bg-[#080604] border border-stone-600 focus:border-orange-400 rounded-xl p-2.5 text-white outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-stone-200 font-semibold mb-1">Ref Doc.</label>
                    <input
                      type="text"
                      value={refDoc}
                      onChange={(e) => setRefDoc(e.target.value)}
                      className="w-full bg-[#080604] border border-stone-600 focus:border-orange-400 rounded-xl p-2.5 text-white outline-none"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-3">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="px-4 py-2 rounded-xl bg-stone-800 border border-stone-600 text-white font-semibold cursor-pointer"
                  >
                    ยกเลิก
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-400 text-stone-950 font-extrabold cursor-pointer"
                  >
                    บันทึก
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal: แก้ไขรายการสินค้า */}
        {isEditModalOpen && editingItem && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="w-full max-w-lg bg-[#16110d] border border-orange-500/40 rounded-3xl p-6 shadow-2xl">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-white text-base">แก้ไขรายการ #{editingItem.id}</h3>
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="text-stone-300 hover:text-white cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSaveEdit} className="space-y-3 text-xs">
                {isAdmin ? (
                  <div className="bg-emerald-950/70 border border-emerald-400/50 rounded-xl p-3 text-emerald-200 font-semibold flex items-center gap-2">
                    <ShieldCheck size={15} className="text-emerald-300" />
                    <span>สิทธิ์ Admin: แก้ไขและบันทึกได้ทันทีโดยไม่ต้องใช้รหัส</span>
                  </div>
                ) : (
                  <div className="bg-orange-500/15 border border-orange-400/50 rounded-xl p-3.5">
                    <label className="block text-xs font-bold text-orange-200 mb-1.5 flex items-center gap-1.5">
                      <KeyRound size={14} /> รหัสอนุมัติยืนยันการแก้ไข (1 รายการ หรือ รหัสหลายรายการ) *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="กรอกรหัสอนุมัติ เช่น APV-... หรือ DAY-..."
                      value={approvalCodeInput}
                      onChange={(e) => setApprovalCodeInput(e.target.value)}
                      className="w-full bg-[#080604] border border-orange-400/60 rounded-xl p-2.5 text-white font-mono focus:outline-none focus:border-orange-300"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-stone-200 font-semibold mb-1">ชื่อผลิตภัณฑ์ (Product Name) *</label>
                  <input
                    type="text"
                    required
                    value={editProductName}
                    onChange={(e) => setEditProductName(e.target.value)}
                    className="w-full bg-[#080604] border border-stone-600 focus:border-orange-400 rounded-xl p-2.5 text-white outline-none"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-stone-200 font-semibold mb-1">Product Code</label>
                    <input
                      type="text"
                      value={editProductCode}
                      onChange={(e) => setEditProductCode(e.target.value)}
                      className="w-full bg-[#080604] border border-stone-600 focus:border-orange-400 rounded-xl p-2.5 text-white outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-stone-200 font-semibold mb-1">จำนวนลัง (Cases)</label>
                    <input
                      type="number"
                      step="any"
                      value={editTotalQty}
                      onChange={(e) => setEditTotalQty(e.target.value)}
                      className="w-full bg-[#080604] border border-stone-600 focus:border-orange-400 rounded-xl p-2.5 text-white outline-none"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-stone-200 font-semibold mb-1">จำนวนขวด (Total Qty_BO)</label>
                    <input
                      type="number"
                      step="any"
                      value={editTotalQtyBo}
                      onChange={(e) => setEditTotalQtyBo(e.target.value)}
                      className="w-full bg-[#080604] border border-stone-600 focus:border-orange-400 rounded-xl p-2.5 text-white outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-stone-200 font-semibold mb-1">ราคาต่อขวด (บาท)</label>
                    <input
                      type="number"
                      step="any"
                      value={editPrice}
                      onChange={(e) => setEditPrice(e.target.value)}
                      className="w-full bg-[#080604] border border-stone-600 focus:border-orange-400 rounded-xl p-2.5 text-white outline-none"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-stone-200 font-semibold mb-1">Custom No.</label>
                    <input
                      type="text"
                      value={editCustomNo}
                      onChange={(e) => setEditCustomNo(e.target.value)}
                      className="w-full bg-[#080604] border border-stone-600 focus:border-orange-400 rounded-xl p-2.5 text-white outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-stone-200 font-semibold mb-1">Ref Doc.</label>
                    <input
                      type="text"
                      value={editRefDoc}
                      onChange={(e) => setEditRefDoc(e.target.value)}
                      className="w-full bg-[#080604] border border-stone-600 focus:border-orange-400 rounded-xl p-2.5 text-white outline-none"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-3">
                  <button
                    type="button"
                    onClick={() => setIsEditModalOpen(false)}
                    className="px-4 py-2 rounded-xl bg-stone-800 border border-stone-600 text-white font-semibold cursor-pointer"
                  >
                    ยกเลิก
                  </button>
                  <button
                    type="submit"
                    disabled={savingEdit}
                    className="px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-stone-950 font-extrabold cursor-pointer"
                  >
                    {savingEdit ? 'กำลังบันทึก...' : isAdmin ? 'บันทึกการแก้ไข' : 'ยืนยันรหัสและบันทึกการแก้ไข'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}