import React, { useState, useEffect, useRef } from 'react';
import { supabase } from './supabaseClient';
import {
  Plus, Package, TrendingUp, Layers, AlertTriangle,
  CheckCircle2, Download, Search, Trash2, X, DollarSign,
  Pencil, ShieldCheck, UserCheck, LogOut, KeyRound, Lock,
  UserPlus, SlidersHorizontal, ClipboardCheck, Bell, Check, Ban, CalendarDays,
  StopCircle, Calendar
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
  // --- Auth & Role State ---
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const saved = localStorage.getItem('sanoh_session_user');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  // Login Form State
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

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
    if (!loginUsername.trim() || !loginPassword.trim()) {
      return alert('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');
    }

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
    localStorage.setItem('sanoh_session_user', JSON.stringify(data));
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

  // ออกจากระบบ
  const handleLogout = () => {
    setCurrentUser(null);
    localStorage.removeItem('sanoh_session_user');
    setIsEditModalOpen(false);
    setIsModalOpen(false);
    setIsRegisterModalOpen(false);
    setIsApprovalModalOpen(false);
    setQtyModalItem(null);
    setRequestModalItem(null);
    setMyRequestsModalOpen(false);
    setLiveIssuedBanner(null);
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

  // --- หน้า Login เท่านั้น เมื่อยังไม่ได้เข้าสู่ระบบ ---
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-[#11161d] text-gray-200 font-sans flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-[#181f29] border border-gray-800 rounded-2xl p-6 sm:p-8 shadow-2xl">
          <div className="text-center mb-6">
            <div className="w-14 h-14 mx-auto rounded-xl bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400 mb-3">
              <Package size={28} />
            </div>
            <p className="text-[11px] font-semibold tracking-wider text-sky-400 uppercase">
              SANOH ANGLO-THAI SHIPPING
            </p>
            <h1 className="text-xl font-bold text-white mt-1">
              ระบบจัดการสต็อก Neck Tag
            </h1>
            <p className="text-xs text-gray-400 mt-1">
              กรุณาเข้าสู่ระบบเพื่อใช้งานระบบ
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-300 mb-1.5">ชื่อผู้ใช้ (Username)</label>
              <input
                type="text"
                required
                placeholder="เช่น admin_sanoh หรือ staff_sanoh"
                value={loginUsername}
                onChange={(e) => setLoginUsername(e.target.value)}
                className="w-full bg-[#12171f] border border-gray-700 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-sky-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-300 mb-1.5">รหัสผ่าน (Password)</label>
              <input
                type="password"
                required
                placeholder="••••••••"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                className="w-full bg-[#12171f] border border-gray-700 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-sky-500"
              />
            </div>
            <button
              type="submit"
              disabled={authLoading}
              className="w-full bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg text-sm transition cursor-pointer"
            >
              {authLoading ? 'กำลังตรวจสอบ...' : 'เข้าสู่ระบบ'}
            </button>
          </form>
        </div>
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
    <div className="min-h-screen bg-[#11161d] text-gray-200 font-sans selection:bg-sky-500/30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">

        {/* แบนเนอร์แจ้งเตือนคำขอรหัสอนุมัติ สำหรับ Admin */}
        {isAdmin && pendingRequests.length > 0 && (
          <div className="mb-5 bg-amber-500/15 border border-amber-400/50 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-lg shadow-amber-950/20">
            <div className="flex items-start sm:items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-400/40 flex items-center justify-center text-amber-300 shrink-0 animate-pulse">
                <Bell size={20} />
              </div>
              <div>
                <p className="text-sm font-bold text-amber-200">
                  แจ้งเตือน: มีคำขอรหัสอนุมัติแก้ไขข้อมูลค้างอยู่ {pendingRequests.length} รายการ
                </p>
                <p className="text-xs text-amber-100/80 mt-0.5">
                  ผู้ขอ: <span className="font-semibold">{pendingRequests[0].requested_by}</span> • {pendingRequests[0].code_scope === 'daily_multi' ? 'ขอรหัสใช้หลายรายการ (เลือกวันก่อนอนุมัติได้)' : `รายการ #${pendingRequests[0].target_item_id}`}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleOpenApprovalModal}
              className="px-4 py-2 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs whitespace-nowrap transition cursor-pointer shrink-0"
            >
              ตรวจสอบและออกรหัส ({pendingRequests.length})
            </button>
          </div>
        )}

        {/* แบนเนอร์เด้งอัตโนมัติฝั่ง User เมื่อแอดมินอนุมัติรหัสให้แล้ว */}
        {!isAdmin && liveIssuedBanner && isCodeActive(liveIssuedBanner) && (
          <div className="mb-5 bg-emerald-500/15 border border-emerald-400/50 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-emerald-300">
                ได้รับรหัสอนุมัติแก้ไขอัตโนมัติ ({liveIssuedBanner.code_scope === 'daily_multi' ? `ใช้ได้ถึง ${formatThaiDateTime(liveIssuedBanner.expires_at)}` : `สำหรับรายการ #${liveIssuedBanner.target_item_id} เท่านั้น`})
              </p>
              <p className="font-mono font-bold text-white text-base mt-1">{liveIssuedBanner.one_time_code}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setApprovalCodeInput(liveIssuedBanner.one_time_code);
                  setMyRequestsModalOpen(true);
                }}
                className="px-3.5 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs cursor-pointer"
              >
                ดูรหัสของฉัน
              </button>
              <button
                type="button"
                onClick={() => setLiveIssuedBanner(null)}
                className="p-2 rounded-lg bg-gray-800 text-gray-300 hover:text-white cursor-pointer"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        )}

        {/* Header */}
        <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-6 border-b border-gray-800">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-xl bg-white/5 border border-sky-500/30 flex items-center justify-center overflow-hidden shadow-inner p-1">
              <img
                src="/logo.png"
                alt="Sanoh Logo"
                className="w-full h-full object-contain"
                onError={(e) => {
                  e.target.style.display = 'none';
                  e.target.nextSibling.style.display = 'flex';
                }}
              />
              <div className="w-full h-full items-center justify-center text-sky-400 hidden">
                <Package size={26} />
              </div>
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold tracking-wider text-sky-400 uppercase">
                  SANOH ANGLO-THAI SHIPPING
                </span>
                <span className={`px-2.5 py-0.5 text-[11px] font-semibold rounded-full flex items-center gap-1 border ${
                  isAdmin
                    ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                    : 'bg-sky-500/15 text-sky-300 border-sky-500/40'
                }`}>
                  {isAdmin ? <ShieldCheck size={12} /> : <UserCheck size={12} />}
                  {currentUser.role} ({currentUser.full_name})
                </span>
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-white mt-0.5">
                บริษัท เสนาะ แองโกลไทย ชิปปิ้ง บริการ จำกัด
              </h1>
              <p className="text-xs text-gray-400">
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
                  className={`relative font-medium px-3.5 py-2.5 rounded-lg text-sm transition flex items-center gap-2 cursor-pointer border ${
                    pendingRequests.length > 0
                      ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border-amber-400/60'
                      : 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border-amber-500/30'
                  }`}
                >
                  <Bell size={16} />
                  <span>คำขอรหัส & Log</span>
                  {pendingRequests.length > 0 && (
                    <span className="px-1.5 py-0.2 rounded-full bg-rose-500 text-white text-[11px] font-bold">
                      {pendingRequests.length}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setIsRegisterModalOpen(true)}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-medium px-3.5 py-2.5 rounded-lg text-sm transition flex items-center gap-1.5 cursor-pointer"
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
                className="bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 font-medium px-3.5 py-2.5 rounded-lg text-sm transition flex items-center gap-1.5 cursor-pointer"
              >
                <KeyRound size={16} /> รหัสที่ขอ ({activeUserCodesCount} พร้อมใช้)
              </button>
            )}

            <button
              type="button"
              onClick={() => setIsModalOpen(true)}
              className="bg-sky-600 hover:bg-sky-500 text-white font-medium px-4 py-2.5 rounded-lg text-sm transition shadow-lg shadow-sky-900/20 flex items-center gap-2 cursor-pointer"
            >
              <Plus size={18} /> เพิ่มรายการ Neck Tag
            </button>
            <button
              type="button"
              onClick={handleExportCSV}
              className="bg-gray-800 hover:bg-gray-750 text-gray-200 border border-gray-700 font-medium px-4 py-2.5 rounded-lg text-sm transition flex items-center gap-2 cursor-pointer"
            >
              <Download size={16} className="text-sky-400" /> Export CSV
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="bg-rose-950/40 hover:bg-rose-900/50 text-rose-300 border border-rose-800/60 font-medium px-3.5 py-2.5 rounded-lg text-sm transition flex items-center gap-1.5 cursor-pointer"
              title="ออกจากระบบ"
            >
              <LogOut size={16} /> ออก
            </button>
          </div>
        </header>

        {/* แถบเมนูนำทาง */}
        <div className="flex flex-wrap items-center justify-between gap-3 my-6">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('dashboard')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2 cursor-pointer ${
                activeTab === 'dashboard'
                  ? 'bg-sky-500/15 text-sky-400 border border-sky-500/40'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/60'
              }`}
            >
              <TrendingUp size={16} /> ภาพรวมสต็อก (Dashboard)
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('inventory')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2 cursor-pointer ${
                activeTab === 'inventory'
                  ? 'bg-sky-500/15 text-sky-400 border border-sky-500/40'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/60'
              }`}
            >
              <Package size={16} /> รายการ Neck Tag ทั้งหมด ({neckTags.length})
            </button>
          </div>

          {!isAdmin && (
            <div className="text-xs text-gray-400 bg-[#181f29] border border-gray-800 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
              <Lock size={13} className="text-amber-400" />
              <span>สิทธิ์ <strong className="text-gray-200">user_shipping</strong>: กรอกยอด/ปรับสต็อกได้ทันที และกด <strong className="text-amber-300">ขอรหัส</strong> ก่อนแก้ไขข้อมูลหลัก</span>
            </div>
          )}
        </div>

        {/* การ์ดสรุปข้อมูล 4 ช่อง */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-[#181f29] border border-gray-800 rounded-xl p-5">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs font-medium text-sky-400">จำนวนขวด / Cases รวม</p>
                <h3 className="text-2xl font-bold text-white mt-2">
                  {totalBottles.toLocaleString()} <span className="text-sm font-normal text-gray-400">ขวด</span>
                </h3>
              </div>
              <div className="p-2.5 bg-sky-500/10 rounded-lg text-sky-400 border border-sky-500/20">
                <TrendingUp size={20} />
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-gray-800/80 flex justify-between text-xs text-gray-400">
              <span>จำนวนลังรวมทั้งหมด</span>
              <span className="text-amber-400 font-semibold">{totalCases.toLocaleString()} Cases</span>
            </div>
          </div>

          <div className="bg-[#181f29] border border-gray-800 rounded-xl p-5">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs font-medium text-emerald-400">มูลค่าสินค้าในคลังรวม</p>
                <h3 className="text-2xl font-bold text-white mt-2">
                  ฿{totalStockValue.toLocaleString()}
                </h3>
              </div>
              <div className="p-2.5 bg-emerald-500/10 rounded-lg text-emerald-400 border border-emerald-500/20">
                <DollarSign size={20} />
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-gray-800/80 flex justify-between text-xs text-gray-400">
              <span>คำนวณจากราคา × จำนวนขวด</span>
              <span className="text-emerald-400 font-medium">THB</span>
            </div>
          </div>

          <div className="bg-[#181f29] border border-gray-800 rounded-xl p-5">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs font-medium text-gray-400">รายการทั้งหมด</p>
                <div className="flex items-baseline gap-2 mt-2">
                  <h3 className="text-2xl font-bold text-white">
                    {neckTags.length.toLocaleString()}
                  </h3>
                  <span className="text-sm text-gray-400">รายการ</span>
                </div>
              </div>
              <div className="p-2.5 bg-gray-800 rounded-lg text-sky-400 border border-gray-700">
                <Layers size={20} />
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-gray-800/80 flex justify-between text-xs text-gray-400">
              <span>ฐานข้อมูล Supabase</span>
              <span className="text-gray-200 font-medium">Active</span>
            </div>
          </div>

          <div className={`border rounded-xl p-5 transition ${
            lowStockItems.length > 0 ? 'bg-rose-950/20 border-rose-900/50' : 'bg-[#181f29] border-gray-800'
          }`}>
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs font-medium text-gray-400">เตือนสต็อกต่ำกว่า 5 ขวด</p>
                <div className="flex items-baseline gap-2 mt-2">
                  <h3 className={`text-2xl font-bold ${lowStockItems.length > 0 ? 'text-rose-400' : 'text-white'}`}>
                    {lowStockItems.length}
                  </h3>
                  <span className="text-sm text-gray-400">รายการ</span>
                </div>
              </div>
              <div className={`p-2.5 rounded-lg border ${
                lowStockItems.length > 0 ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' : 'bg-gray-800 text-gray-400 border-gray-700'
              }`}>
                <AlertTriangle size={20} />
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-gray-800/80 flex justify-between text-xs">
              <span className="text-gray-400">สถานะการจัดการ</span>
              <span className={lowStockItems.length > 0 ? 'text-rose-400 font-medium' : 'text-emerald-400'}>
                {lowStockItems.length > 0 ? 'ควรตรวจสอบสต็อก' : 'ปกติ'}
              </span>
            </div>
          </div>
        </div>

        {/* ส่วนเนื้อหาหลัก */}
        {activeTab === 'dashboard' ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

            {/* รายการสต็อกต่ำ */}
            <div className="lg:col-span-5 bg-[#181f29] border border-gray-800 rounded-xl p-5 flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={18} className="text-sky-400" />
                  <h2 className="font-semibold text-white text-sm">รายการสต็อกน้อย (Low Stock)</h2>
                </div>
                <span className="px-2.5 py-0.5 text-xs bg-sky-500/10 text-sky-400 border border-sky-500/30 rounded-full">
                  {lowStockItems.length} Items
                </span>
              </div>

              {lowStockItems.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center py-10 text-center border border-dashed border-gray-800 rounded-lg">
                  <CheckCircle2 size={32} className="text-sky-500/50 mb-2" />
                  <p className="text-sm text-gray-400">ไม่มีรายการสต็อกต่ำกว่าเกณฑ์</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
                  {lowStockItems.map((item) => (
                    <div key={item.id} className="bg-[#12171f] border border-gray-800 rounded-lg p-3.5 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-white">{item["Product Name"]}</p>
                        <p className="text-xs text-gray-400 mt-1">
                          รหัส: {item["Product Code"]} | คงเหลือ: <span className="text-rose-400 font-semibold">{item["Total Qty_BO"]} ขวด</span> ({item["Total Qty"] || 0} Cases)
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleUpdateStock(item.id, (parseFloat(item["Total Qty_BO"]) || 0) + 10)}
                        className="px-3 py-1.5 bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 border border-sky-500/30 rounded-lg text-xs font-medium transition whitespace-nowrap cursor-pointer"
                      >
                        + เติม 10
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* รายการ Neck Tag ล่าสุด */}
            <div className="lg:col-span-7 bg-[#181f29] border border-gray-800 rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Package size={18} className="text-sky-400" />
                  <h2 className="font-semibold text-white text-sm">รายการคอขวด (Neck Tag) ล่าสุด</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('inventory')}
                  className="text-xs text-sky-400 hover:text-sky-300 font-medium cursor-pointer"
                >
                  ดูทั้งหมด →
                </button>
              </div>

              <div className="divide-y divide-gray-800/80">
                {neckTags.slice(0, 6).map((item) => {
                  const qtyBo = parseFloat(item["Total Qty_BO"]) || 0;
                  const unitPrice = parseFloat(item["Price"]) || 0;
                  return (
                    <div key={item.id} className="py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-white truncate">{item["Product Name"]}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          #{item.id} • {item["Product Code"]} • {item["Date IN"] || '-'}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-semibold text-sky-400">{qtyBo.toLocaleString()} ขวด</p>
                        <p className="text-xs text-emerald-400">฿{(qtyBo * unitPrice).toLocaleString()}</p>
                      </div>
                    </div>
                  );
                })}
                {neckTags.length === 0 && !loading && (
                  <p className="py-8 text-center text-xs text-gray-400">ยังไม่มีข้อมูลในตาราง stock_neck_tags</p>
                )}
              </div>
            </div>
          </div>
        ) : (
          /* ตารางรายการ Neck Tag ทั้งหมด */
          <div className="bg-[#181f29] border border-gray-800 rounded-xl p-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <h2 className="font-semibold text-white text-sm">รายการสต็อกคอขวด (Neck Tag) ทั้งหมด</h2>
              <div className="relative w-full sm:w-80">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="ค้นหาชื่อสินค้า, รหัส, เลขที่ใบขน, วันที่..."
                  className="w-full bg-[#12171f] border border-gray-700 rounded-lg pl-9 pr-3 py-2 text-xs text-white focus:outline-none focus:border-sky-500"
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-gray-800 text-gray-400">
                    <th className="py-3 px-2">ID</th>
                    <th className="py-3 px-2">วันที่รับเข้า</th>
                    <th className="py-3 px-2">ชื่อผลิตภัณฑ์ / รหัส</th>
                    <th className="py-3 px-2 text-right">Cases</th>
                    <th className="py-3 px-2 text-center">จำนวนขวด</th>
                    <th className="py-3 px-2 text-right">ราคา/ขวด</th>
                    <th className="py-3 px-2 text-right">มูลค่ารวม</th>
                    <th className="py-3 px-2 text-center">จัดการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/70">
                  {filteredTags.map((item) => {
                    const qtyBo = parseFloat(item["Total Qty_BO"]) || 0;
                    const unitPrice = parseFloat(item["Price"]) || 0;
                    return (
                      <tr key={item.id} className="hover:bg-white/[0.02]">
                        <td className="py-3 px-2 font-mono text-gray-400">{item.id}</td>
                        <td className="py-3 px-2 text-gray-300 whitespace-nowrap">{item["Date IN"] || '-'}</td>
                        <td className="py-3 px-2">
                          <p className="font-medium text-white">{item["Product Name"]}</p>
                          <p className="text-[11px] text-gray-400">
                            Code: {item["Product Code"]} | Custom: {item["Cutom No."]} | Ref: {item["Ref Doc."]}
                          </p>
                        </td>
                        <td className="py-3 px-2 text-right text-amber-300 font-medium">{item["Total Qty"] || 0}</td>
                        <td className="py-3 px-2">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleUpdateStock(item.id, qtyBo - 1)}
                              className="w-6 h-6 rounded bg-gray-800 hover:bg-gray-700 text-gray-200 font-bold cursor-pointer"
                            >
                              -
                            </button>
                            <span className="min-w-[42px] text-center font-semibold text-white">
                              {qtyBo.toLocaleString()}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleUpdateStock(item.id, qtyBo + 1)}
                              className="w-6 h-6 rounded bg-gray-800 hover:bg-gray-700 text-gray-200 font-bold cursor-pointer"
                            >
                              +
                            </button>
                          </div>
                        </td>
                        <td className="py-3 px-2 text-right text-gray-300">฿{unitPrice.toLocaleString()}</td>
                        <td className="py-3 px-2 text-right text-emerald-400 font-semibold">
                          ฿{(qtyBo * unitPrice).toLocaleString()}
                        </td>
                        <td className="py-3 px-2">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => openDirectQtyModal(item)}
                              className="px-2 py-1 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-500/30 text-[11px] font-medium flex items-center gap-1 cursor-pointer"
                              title="พิมพ์จำนวนขวดและจำนวนลังโดยตรง"
                            >
                              <SlidersHorizontal size={12} /> กรอกยอด
                            </button>

                            {!isAdmin && (
                              <button
                                type="button"
                                onClick={() => handleOpenRequestCodeModal(item)}
                                className="px-2 py-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[11px] font-medium flex items-center gap-1 cursor-pointer"
                                title="ส่งคำขอรหัสอนุมัติไปยังแอดมิน"
                              >
                                <Bell size={12} /> ขอแก้
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => handleOpenEditModal(item)}
                              className="p-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 cursor-pointer"
                              title={isAdmin ? 'แก้ไขรายการได้ทันที' : 'แก้ไขรายการ (ต้องใช้รหัสอนุมัติ)'}
                            >
                              <Pencil size={14} />
                            </button>

                            {isAdmin && (
                              <button
                                type="button"
                                onClick={() => handleDeleteTag(item.id, item["Product Name"])}
                                className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 cursor-pointer"
                                title="ลบรายการ"
                              >
                                <Trash2 size={14} />
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
          <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-[#181f29] border border-gray-800 rounded-2xl p-6 shadow-2xl">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Bell size={18} className="text-amber-400" />
                  <h3 className="font-bold text-white text-base">ขอรหัสอนุมัติแก้ไข #{requestModalItem.id}</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setRequestModalItem(null)}
                  className="text-gray-400 hover:text-white cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>
              <p className="text-xs text-gray-400 mb-4 truncate">{requestModalItem["Product Name"]}</p>

              <form onSubmit={handleSubmitApprovalRequest} className="space-y-3 text-xs">
                <div>
                  <label className="block text-gray-300 mb-1.5">รูปแบบรหัสที่ต้องการขอ</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setRequestScope('single_item')}
                      className={`p-2.5 rounded-lg border text-left transition cursor-pointer ${
                        requestScope === 'single_item'
                          ? 'bg-amber-500/20 border-amber-400 text-amber-200 font-semibold'
                          : 'bg-[#12171f] border-gray-700 text-gray-400'
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <KeyRound size={13} /> 1 รหัส / 1 รายการ
                      </div>
                      <p className="text-[10px] opacity-80 mt-0.5">ใช้แก้รายการนี้ 1 ครั้ง</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setRequestScope('daily_multi')}
                      className={`p-2.5 rounded-lg border text-left transition cursor-pointer ${
                        requestScope === 'daily_multi'
                          ? 'bg-sky-500/20 border-sky-400 text-sky-200 font-semibold'
                          : 'bg-[#12171f] border-gray-700 text-gray-400'
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <CalendarDays size={13} /> หลายรายการ (กำหนดวัน)
                      </div>
                      <p className="text-[10px] opacity-80 mt-0.5">ต้องยืนยันตัวตนผู้ขอ</p>
                    </button>
                  </div>
                </div>

                {requestScope === 'daily_multi' && (
                  <div className="p-3 rounded-xl bg-sky-500/10 border border-sky-500/30 space-y-2.5">
                    <p className="text-[11px] font-semibold text-sky-300">
                      ยืนยันตัวตนผู้ขอรหัสแบบหลายรายการ (Username & Password)
                    </p>
                    <div>
                      <label className="block text-gray-300 mb-1">Username ผู้ขอ</label>
                      <input
                        type="text"
                        required
                        value={verifyUsername}
                        onChange={(e) => setVerifyUsername(e.target.value)}
                        className="w-full bg-[#12171f] border border-gray-700 rounded-lg p-2 text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-300 mb-1">Password ผู้ขอ</label>
                      <input
                        type="password"
                        required
                        placeholder="กรอกรหัสผ่านเพื่อยืนยันตัวตน"
                        value={verifyPassword}
                        onChange={(e) => setVerifyPassword(e.target.value)}
                        className="w-full bg-[#12171f] border border-gray-700 rounded-lg p-2 text-white"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-gray-300 mb-1">เหตุผลที่ขอแก้ไข (แจ้งให้แอดมินเห็น)</label>
                  <input
                    type="text"
                    required
                    placeholder="เช่น แก้ไขราคาต่อขวด หรือเลขที่ใบขนให้ตรงเอกสาร"
                    value={requestNote}
                    onChange={(e) => setRequestNote(e.target.value)}
                    className="w-full bg-[#12171f] border border-gray-700 rounded-lg p-2.5 text-white focus:outline-none focus:border-amber-400"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setRequestModalItem(null)}
                    className="px-4 py-2 rounded-lg bg-gray-800 text-gray-200 cursor-pointer"
                  >
                    ยกเลิก
                  </button>
                  <button
                    type="submit"
                    disabled={submittingRequest}
                    className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-semibold cursor-pointer"
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
          <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="w-full max-w-lg bg-[#181f29] border border-gray-800 rounded-2xl p-6 shadow-2xl">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-white text-base">สถานะคำขอรหัสอนุมัติของฉัน</h3>
                <button
                  type="button"
                  onClick={() => setMyRequestsModalOpen(false)}
                  className="text-gray-400 hover:text-white cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="max-h-72 overflow-y-auto space-y-2.5 text-xs">
                {myRequests.length === 0 ? (
                  <p className="text-center text-gray-400 py-6">ยังไม่มีคำขอรหัสอนุมัติ</p>
                ) : (
                  myRequests.map((row) => {
                    const active = isCodeActive(row);
                    return (
                      <div key={row.id} className="p-3 rounded-xl bg-[#12171f] border border-gray-800 flex items-center justify-between gap-3">
                        <div>
                          <p className="font-semibold text-white">
                            {row.code_scope === 'daily_multi' ? 'รหัสแก้ไขหลายรายการ' : `รายการ #${row.target_item_id || '-'} • ${row.target_product_name || '-'}`}
                          </p>
                          <p className="text-[11px] text-gray-400 mt-0.5">
                            {row.note || '-'}
                            {row.code_scope === 'daily_multi' && row.expires_at ? ` • หมดอายุ: ${formatThaiDateTime(row.expires_at)}` : ''}
                          </p>
                          {row.status === 'approved' && row.one_time_code && (
                            <p className={`font-mono font-bold mt-1 ${active ? 'text-emerald-400' : 'text-rose-400'}`}>
                              รหัส: {row.one_time_code} {active ? '(พร้อมใช้)' : '(หยุดใช้ / หมดอายุ / ใช้ครบแล้ว)'}
                            </p>
                          )}
                        </div>
                        <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border shrink-0 ${
                          active
                            ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                            : row.status === 'rejected' || (row.status === 'approved' && !active)
                            ? 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                            : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
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
          <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="w-full max-w-2xl bg-[#181f29] border border-gray-800 rounded-2xl p-6 shadow-2xl">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <ClipboardCheck size={18} className="text-amber-400" />
                  <h3 className="font-bold text-white text-base">คำขอรหัสอนุมัติ & ประวัติการแก้ไข</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setIsApprovalModalOpen(false)}
                  className="text-gray-400 hover:text-white cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              {latestIssuedInfo && (
                <div className="mb-4 p-3.5 rounded-xl bg-emerald-500/15 border border-emerald-400/40 text-xs">
                  <p className="text-emerald-200 font-semibold">
                    ออกรหัส ({latestIssuedInfo.scope === 'daily_multi' ? `ใช้ได้ถึง ${formatThaiDateTime(latestIssuedInfo.expiresAt)}` : '1 รหัส / 1 รายการ'}) ให้ <span className="underline">{latestIssuedInfo.requestedBy}</span>
                  </p>
                  <p className="font-mono font-bold text-white text-base mt-1">{latestIssuedInfo.code}</p>
                </div>
              )}

              <div className="max-h-96 overflow-y-auto border border-gray-800 rounded-xl divide-y divide-gray-800/80 text-xs">
                {loadingApprovalLogs ? (
                  <p className="p-4 text-center text-gray-400">กำลังโหลดข้อมูล...</p>
                ) : approvalLogs.length === 0 ? (
                  <p className="p-4 text-center text-gray-400">ยังไม่มีรายการคำขอหรือประวัติการแก้ไข</p>
                ) : (
                  approvalLogs.map((row) => {
                    const active = isCodeActive(row);
                    const expirySel = getExpirySelectionForRow(row.id);

                    return (
                      <div key={row.id} className="p-3.5 bg-[#12171f] flex flex-col gap-3">
                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                                row.status === 'pending'
                                  ? 'bg-amber-500/20 text-amber-300 border-amber-400/40'
                                  : active
                                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                  : 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                              }`}>
                                {row.status === 'pending' ? 'รออนุมัติ' : active ? 'กำลังใช้งานได้' : row.status === 'rejected' ? 'ปฏิเสธ' : 'หยุดใช้ / หมดเวลา'}
                              </span>
                              <span className="px-2 py-0.5 rounded bg-gray-800 text-gray-300 text-[10px]">
                                {row.code_scope === 'daily_multi' ? 'หลายรายการ' : row.code_scope === 'admin_free' ? 'Admin แก้ตรง' : '1 รายการ'}
                              </span>
                              <span className="font-semibold text-white">
                                รายการ #{row.target_item_id || '-'} • {row.target_product_name || '-'}
                              </span>
                            </div>
                            <p className="text-[11px] text-gray-400">
                              ผู้ดำเนินการ: <span className="text-gray-200">{row.requested_by || '-'}</span> • {row.note || '-'}
                              {row.code_scope === 'daily_multi' && row.expires_at ? ` • หมดอายุ: ${formatThaiDateTime(row.expires_at)}` : ''}
                            </p>
                            {row.one_time_code && (
                              <p className="font-mono text-[11px] text-sky-300">
                                รหัส: {row.one_time_code} {active ? '(ใช้งานได้)' : '(ปิดใช้งานแล้ว)'}
                              </p>
                            )}
                          </div>

                          {active && (
                            <button
                              type="button"
                              disabled={processingRequestId === row.id}
                              onClick={() => handleStopApprovalCode(row)}
                              className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-semibold flex items-center gap-1 cursor-pointer shrink-0"
                              title="หยุดการใช้งานรหัสนี้ทันที"
                            >
                              <StopCircle size={14} /> หยุดใช้รหัส
                            </button>
                          )}
                        </div>

                        {/* ตอนก่อนกดอนุมัติ: ถ้าเป็นคำขอแบบหลายรายการ ให้แอดมินเลือกวัน (และเวลา) หมดอายุก่อนกดปุ่มอนุมัติ */}
                        {row.status === 'pending' && (
                          <div className="pt-2.5 border-t border-gray-800/80 flex flex-wrap items-center justify-between gap-2">
                            {row.code_scope === 'daily_multi' ? (
                              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                                <span className="text-sky-300 font-medium flex items-center gap-1">
                                  <Calendar size={13} /> ใช้งได้ถึงวันที่:
                                </span>
                                <input
                                  type="date"
                                  value={expirySel.date}
                                  onChange={(e) => updateExpirySelectionForRow(row.id, { date: e.target.value })}
                                  className="bg-[#181f29] border border-gray-700 rounded-lg px-2 py-1 text-white focus:outline-none focus:border-sky-500"
                                />
                                <input
                                  type="time"
                                  value={expirySel.time}
                                  onChange={(e) => updateExpirySelectionForRow(row.id, { time: e.target.value })}
                                  className="bg-[#181f29] border border-gray-700 rounded-lg px-2 py-1 text-white focus:outline-none focus:border-sky-500"
                                />
                              </div>
                            ) : (
                              <span className="text-[11px] text-gray-400">รหัสแบบ 1 รายการ (ใช้ได้ 1 ครั้ง)</span>
                            )}

                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                disabled={processingRequestId === row.id}
                                onClick={() => handleApproveRequest(row)}
                                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold flex items-center gap-1 cursor-pointer"
                              >
                                <Check size={14} /> อนุมัติ
                              </button>
                              <button
                                type="button"
                                disabled={processingRequestId === row.id}
                                onClick={() => handleRejectRequest(row)}
                                className="px-3 py-1.5 rounded-lg bg-rose-950 hover:bg-rose-900 text-rose-300 border border-rose-800 font-semibold flex items-center gap-1 cursor-pointer"
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
          <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="w-full max-w-sm bg-[#181f29] border border-gray-800 rounded-2xl p-6 shadow-2xl">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-white text-base">กรอกจำนวนสต็อก #{qtyModalItem.id}</h3>
                <button
                  type="button"
                  onClick={() => setQtyModalItem(null)}
                  className="text-gray-400 hover:text-white cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>
              <p className="text-xs text-gray-400 mb-4 truncate">{qtyModalItem["Product Name"]}</p>

              <form onSubmit={handleDirectQtySubmit} className="space-y-3 text-xs">
                <div>
                  <label className="block text-gray-300 mb-1">จำนวนขวดทั้งหมด (Total Qty_BO)</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    required
                    value={directBottles}
                    onChange={(e) => setDirectBottles(e.target.value)}
                    className="w-full bg-[#12171f] border border-gray-700 rounded-lg p-2.5 text-white focus:outline-none focus:border-sky-500"
                  />
                </div>
                <div>
                  <label className="block text-gray-300 mb-1">จำนวนลังทั้งหมด (Total Qty)</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    required
                    value={directCases}
                    onChange={(e) => setDirectCases(e.target.value)}
                    className="w-full bg-[#12171f] border border-gray-700 rounded-lg p-2.5 text-white focus:outline-none focus:border-sky-500"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-3">
                  <button
                    type="button"
                    onClick={() => setQtyModalItem(null)}
                    className="px-4 py-2 rounded-lg bg-gray-800 text-gray-200 cursor-pointer"
                  >
                    ยกเลิก
                  </button>
                  <button
                    type="submit"
                    disabled={savingDirectQty}
                    className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-semibold cursor-pointer"
                  >
                    {savingDirectQty ? 'กำลังบันทึก...' : 'บันทึกยอด'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal: ลงทะเบียน Staff (เฉพาะ admin_shipping และล็อก role เป็น user_shipping) */}
        {isRegisterModalOpen && isAdmin && (
          <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-[#181f29] border border-gray-800 rounded-2xl p-6 shadow-2xl">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <UserPlus size={18} className="text-emerald-400" />
                  <h3 className="font-bold text-white text-base">ลงทะเบียนบัญชีพนักงาน (Staff)</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setIsRegisterModalOpen(false)}
                  className="text-gray-400 hover:text-white cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <p className="text-xs text-gray-400 mb-4">
                สิทธิ์ที่ได้รับอัตโนมัติ: <span className="text-sky-300 font-semibold">user_shipping</span>
              </p>

              <form onSubmit={handleRegisterStaff} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-300 mb-1">ชื่อ-นามสกุล / แผนก</label>
                  <input
                    type="text"
                    required
                    placeholder="เช่น สมชาย คลังสินค้า"
                    value={staffFullName}
                    onChange={(e) => setStaffFullName(e.target.value)}
                    className="w-full bg-[#12171f] border border-gray-700 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-300 mb-1">ชื่อผู้ใช้ (Username)</label>
                  <input
                    type="text"
                    required
                    placeholder="ตั้งชื่อผู้ใช้สำหรับ Staff"
                    value={staffUsername}
                    onChange={(e) => setStaffUsername(e.target.value)}
                    className="w-full bg-[#12171f] border border-gray-700 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-300 mb-1">รหัสผ่าน (Password)</label>
                  <input
                    type="password"
                    required
                    placeholder="ตั้งรหัสผ่าน"
                    value={staffPassword}
                    onChange={(e) => setStaffPassword(e.target.value)}
                    className="w-full bg-[#12171f] border border-gray-700 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsRegisterModalOpen(false)}
                    className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-xs text-gray-200 cursor-pointer"
                  >
                    ยกเลิก
                  </button>
                  <button
                    type="submit"
                    disabled={registeringStaff}
                    className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-xs font-semibold text-white cursor-pointer"
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
          <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="w-full max-w-lg bg-[#181f29] border border-gray-800 rounded-2xl p-6 shadow-2xl">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-white text-base">เพิ่มรายการ Neck Tag</h3>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="text-gray-400 hover:text-white cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>
              <form onSubmit={handleAddTag} className="space-y-3 text-xs">
                <div>
                  <label className="block text-gray-300 mb-1">ชื่อผลิตภัณฑ์ (Product Name) *</label>
                  <input
                    type="text"
                    required
                    value={productName}
                    onChange={(e) => setProductName(e.target.value)}
                    className="w-full bg-[#12171f] border border-gray-700 rounded-lg p-2.5 text-white"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-gray-300 mb-1">Product Code</label>
                    <input
                      type="text"
                      value={productCode}
                      onChange={(e) => setProductCode(e.target.value)}
                      className="w-full bg-[#12171f] border border-gray-700 rounded-lg p-2.5 text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-300 mb-1">วันที่รับเข้า (Date IN)</label>
                    <input
                      type="text"
                      placeholder="เว้นว่างเพื่อใช้เวลาปัจจุบัน"
                      value={dateIn}
                      onChange={(e) => setDateIn(e.target.value)}
                      className="w-full bg-[#12171f] border border-gray-700 rounded-lg p-2.5 text-white"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-gray-300 mb-1">จำนวนลัง (Cases)</label>
                    <input
                      type="number"
                      step="any"
                      value={totalQty}
                      onChange={(e) => setTotalQty(e.target.value)}
                      className="w-full bg-[#12171f] border border-gray-700 rounded-lg p-2.5 text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-300 mb-1">จำนวนขวด (Total Qty_BO)</label>
                    <input
                      type="number"
                      step="any"
                      value={totalQtyBo}
                      onChange={(e) => setTotalQtyBo(e.target.value)}
                      className="w-full bg-[#12171f] border border-gray-700 rounded-lg p-2.5 text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-300 mb-1">ราคาต่อขวด (บาท)</label>
                    <input
                      type="number"
                      step="any"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      className="w-full bg-[#12171f] border border-gray-700 rounded-lg p-2.5 text-white"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-gray-300 mb-1">Custom No.</label>
                    <input
                      type="text"
                      value={customNo}
                      onChange={(e) => setCustomNo(e.target.value)}
                      className="w-full bg-[#12171f] border border-gray-700 rounded-lg p-2.5 text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-300 mb-1">Ref Doc.</label>
                    <input
                      type="text"
                      value={refDoc}
                      onChange={(e) => setRefDoc(e.target.value)}
                      className="w-full bg-[#12171f] border border-gray-700 rounded-lg p-2.5 text-white"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-3">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="px-4 py-2 rounded-lg bg-gray-800 text-gray-200 cursor-pointer"
                  >
                    ยกเลิก
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold cursor-pointer"
                  >
                    บันทึก
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal: แก้ไขรายการสินค้า (Admin แก้ได้อิสระ / User ต้องใช้รหัสอนุมัติ) */}
        {isEditModalOpen && editingItem && (
          <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="w-full max-w-lg bg-[#181f29] border border-gray-800 rounded-2xl p-6 shadow-2xl">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-white text-base">แก้ไขรายการ #{editingItem.id}</h3>
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="text-gray-400 hover:text-white cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSaveEdit} className="space-y-3 text-xs">
                {isAdmin ? (
                  <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 text-emerald-300 flex items-center gap-2">
                    <ShieldCheck size={15} />
                    <span>สิทธิ์ Admin: แก้ไขและบันทึกได้ทันทีโดยไม่ต้องใช้รหัส</span>
                  </div>
                ) : (
                  <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3.5">
                    <label className="block text-xs font-semibold text-amber-300 mb-1.5 flex items-center gap-1.5">
                      <KeyRound size={14} /> รหัสอนุมัติยืนยันการแก้ไข (1 รายการ หรือ รหัสหลายรายการ) *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="กรอกรหัสอนุมัติ เช่น APV-... หรือ DAY-..."
                      value={approvalCodeInput}
                      onChange={(e) => setApprovalCodeInput(e.target.value)}
                      className="w-full bg-[#12171f] border border-amber-500/40 rounded-lg p-2.5 text-white font-mono focus:outline-none focus:border-amber-400"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-gray-300 mb-1">ชื่อผลิตภัณฑ์ (Product Name) *</label>
                  <input
                    type="text"
                    required
                    value={editProductName}
                    onChange={(e) => setEditProductName(e.target.value)}
                    className="w-full bg-[#12171f] border border-gray-700 rounded-lg p-2.5 text-white"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-gray-300 mb-1">Product Code</label>
                    <input
                      type="text"
                      value={editProductCode}
                      onChange={(e) => setEditProductCode(e.target.value)}
                      className="w-full bg-[#12171f] border border-gray-700 rounded-lg p-2.5 text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-300 mb-1">จำนวนลัง (Cases)</label>
                    <input
                      type="number"
                      step="any"
                      value={editTotalQty}
                      onChange={(e) => setEditTotalQty(e.target.value)}
                      className="w-full bg-[#12171f] border border-gray-700 rounded-lg p-2.5 text-white"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-gray-300 mb-1">จำนวนขวด (Total Qty_BO)</label>
                    <input
                      type="number"
                      step="any"
                      value={editTotalQtyBo}
                      onChange={(e) => setEditTotalQtyBo(e.target.value)}
                      className="w-full bg-[#12171f] border border-gray-700 rounded-lg p-2.5 text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-300 mb-1">ราคาต่อขวด (บาท)</label>
                    <input
                      type="number"
                      step="any"
                      value={editPrice}
                      onChange={(e) => setEditPrice(e.target.value)}
                      className="w-full bg-[#12171f] border border-gray-700 rounded-lg p-2.5 text-white"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-gray-300 mb-1">Custom No.</label>
                    <input
                      type="text"
                      value={editCustomNo}
                      onChange={(e) => setEditCustomNo(e.target.value)}
                      className="w-full bg-[#12171f] border border-gray-700 rounded-lg p-2.5 text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-300 mb-1">Ref Doc.</label>
                    <input
                      type="text"
                      value={editRefDoc}
                      onChange={(e) => setEditRefDoc(e.target.value)}
                      className="w-full bg-[#12171f] border border-gray-700 rounded-lg p-2.5 text-white"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-3">
                  <button
                    type="button"
                    onClick={() => setIsEditModalOpen(false)}
                    className="px-4 py-2 rounded-lg bg-gray-800 text-gray-200 cursor-pointer"
                  >
                    ยกเลิก
                  </button>
                  <button
                    type="submit"
                    disabled={savingEdit}
                    className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-semibold cursor-pointer"
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