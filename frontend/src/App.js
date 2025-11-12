import React, { useState, useEffect, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, Navigate, useLocation } from 'react-router-dom';
import { Navbar, Nav, Container, NavDropdown, Badge } from 'react-bootstrap'; // เพิ่ม Badge

// Core Components
import About from './components/About';
import './index.css';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap/dist/js/bootstrap.bundle.min.js';

// User Management Components
import User from './components/manage_user/User'
import Login from './components/manage_user/Login';
import Logout from './components/manage_user/Logout';
import Register from './components/manage_user/Register';

// Inventory & Item Components

// Inventory
import AddLocation from './components/inventory/AddLocation'
import InventoryView from './components/inventory/InventoryView';
import ItemMaster from './components/inventory/Item_Master';

// Transaction-Inventory
import PendingReceiveModal from './components/transaction_inventory/PendingReceiveModal';
import ReceiveMaterial from './components/transaction_inventory/ReceiveMaterial'; // <-- แก้ไข Path 
import TransferMaterial from './components/transaction_inventory/TransferMaterial';
import ScheduleHistory from './components/transaction_inventory/ScheduleHistory';

// const API_BASE = 'http://10.121.1.85:3202/api';
const API_BASE = 'http://localhost:5000/api';

// --- Global API Call Function ---
const apiCall = async (endpoint, options = {}) => {
  const token = localStorage.getItem('token');
  const config = {
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    ...options,
  };

  try {
    const response = await fetch(`${API_BASE}${endpoint}`, config);
    const data = await response.json();

    if (!response.ok) {
      if (response.status === 401) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        // แก้ไข: เพิ่ม basename เข้าไปใน redirect
        window.location.href = '/MECHA-MATERIAL-SYSTEM/login'; 
        throw new Error('Session expired. Please log in again.');
      }
      throw new Error(data.message || 'Something went wrong');
    }

    return data;
  } catch (error) {
    throw error;
  }
};

// --- Protected Route Component ---
const ProtectedRoute = ({ children }) => {
  const isAuthenticated = !!localStorage.getItem('token');
  const location = useLocation();

  return isAuthenticated ? children : <Navigate to="/login" state={{ from: location }} replace />;
};

// --- 404 Not Found Component ---
const NotFound = () => {
  return (
    <Container className="text-center mt-5">
      <h2>404 - Page Not Found</h2>
      <p>Sorry kub. Don't Have This Page eiei</p>
      <Link to="/">Get back Get back</Link>
    </Container>
  );
};

// --- Main Navbar Component ---
const ConditionalNavbar = ({ user, onLogout, pendingCount }) => {
  const location = useLocation();

  const hideNavbarPaths = ['/login', '/register'];
  if (hideNavbarPaths.includes(location.pathname)) {
    return null;
  }

  // ดึง Role จาก user prop
  const canAccessAdmin = user?.role === 'ADMIN';
  const canAccessReceive = ['ADMIN', 'RECEIVE'].includes(user?.role);

  return (
    <Navbar bg="dark" variant="dark" expand="lg" className="mb-4">
      <Container>
        <Navbar.Brand as={Link} to="/">
          Material Control System
        </Navbar.Brand>
        <Navbar.Toggle aria-controls="basic-navbar-nav" />
        <Navbar.Collapse id="basic-navbar-nav">
          
          {/* Left Nav */}
          <Nav className="me-auto">
            
            {/* Inventory Menu (สำหรับ RECEIVE & ADMIN) */}
            {canAccessReceive && (
              <NavDropdown 
                title={
                  <span>
                    Transaction Inventory 
                    {/* Badge สำหรับ Notification */}
                    {pendingCount > 0 && (
                      <Badge pill bg="danger" className="ms-1">{pendingCount}</Badge>
                    )}
                  </span>
                } 
                id="inventory-dropdown"
              >
                <NavDropdown.Item as={Link} to="/receive-material">
                  รับเข้า Mat'l
                </NavDropdown.Item>
                <NavDropdown.Item as={Link} to="/schedule-history">
                  รายการรับเข้าล่วงหน้า
                  {pendingCount > 0 && (
                      <Badge pill bg="danger" className="ms-1">{pendingCount}</Badge>
                    )}
                </NavDropdown.Item>
                <NavDropdown.Item as={Link} to="/transfer-material">
                  Transfer Stock
                </NavDropdown.Item>
              </NavDropdown>
            )}
            
            {/* Inventory Menu (สำหรับ RECEIVE & ADMIN) */}
            {canAccessReceive && (
              <NavDropdown 
                title={
                  <span>
                    Inventory 
                  </span>
                } 
                id="inventory-dropdown"
              >
                <NavDropdown.Item as={Link} to="/add-location">
                  เพิ่ม Location
                </NavDropdown.Item>
                <NavDropdown.Item as={Link} to="/inventory">
                  ตรวจสอบ Stock
                </NavDropdown.Item>
                <NavDropdown.Item as={Link} to="/item-master">
                  Item Master
                </NavDropdown.Item>
              </NavDropdown>
            )}

            {/* Admin Menu (สำหรับ ADMIN เท่านั้น) */}
            {canAccessAdmin && (
               <NavDropdown title="Admin" id="admin-dropdown">
                 <NavDropdown.Item as={Link} to="/item-master">
                   Item Master
                 </NavDropdown.Item>
                 <NavDropdown.Item as={Link} to="/user">
                   User Management
                 </NavDropdown.Item>
               </NavDropdown>
            )}

            <Nav.Link as={Link} to="/about">About</Nav.Link>
          </Nav>

          

          {/* Right Nav */}
          <Nav>
            {user?.name && (
              <Navbar.Text className="me-3">
                User: {user.name} ({user.role})
              </Navbar.Text>
            )}
            <Nav.Link as={Link} to="/logout">Logout</Nav.Link>
          </Nav>

        </Navbar.Collapse>
      </Container>
    </Navbar>
  );
};

// --- Main App Component ---
const App = () => {
  const [isLoggedIn, setIsLoggedIn] = useState(!!localStorage.getItem('token'));
  const [user, setUser] = useState(JSON.parse(localStorage.getItem('user') || 'null'));

  const [pendingItems, setPendingItems] = useState([]);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [loadingPopup, setLoadingPopup] = useState(false); 
  const [pendingCount, setPendingCount] = useState(0);
  
  // --- 1. ADDED: State สำหรับ Snooze ---
  const [snoozeUntil, setSnoozeUntil] = useState(null);

  // ฟังก์ชันส่วนกลางสำหรับ Login
  const handleLogin = () => {
    setIsLoggedIn(true);
    setUser(JSON.parse(localStorage.getItem('user') || 'null'));
    setSnoozeUntil(null); // เคลียร์ Snooze
    checkPendingReceives(); 
  };

  // ฟังก์ชันส่วนกลางสำหรับ Logout
  const handleLogout = () => {
    setIsLoggedIn(false);
    setUser(null);
    setPendingItems([]); 
    setShowConfirmModal(false);
    setPendingCount(0);
    setSnoozeUntil(null); // เคลียร์ Snooze
  };
  
  // ฟังก์ชันดึงข้อมูล
  const checkPendingReceives = useCallback(async () => {
    // --- 2. UPDATED: เพิ่มเงื่อนไขเช็ค Snooze ---
    if (!localStorage.getItem('token') || showConfirmModal || loadingPopup) return; 

    // ถ้ายังอยู่ในเวลา Snooze, ให้ออกจากฟังก์ชันทันที
    if (snoozeUntil && Date.now() < snoozeUntil) {
      console.log("Snoozing... skipping check.");
      return;
    }
    // --- End Update ---

    setLoadingPopup(true);
    try {
      const [overdueData, countData] = await Promise.all([
        apiCall('/receive/pending'),      
        apiCall('/receive/pending-count') 
      ]);
      
      if (overdueData && overdueData.length > 0) {
        setPendingItems(overdueData);
        setShowConfirmModal(true); 
      } else {
        setPendingItems([]);
        setShowConfirmModal(false);
      }
      
      if (countData) {
        setPendingCount(countData.pendingCount);
      }

    } catch (err) {
      console.error("No permission or failed to check pending receives:", err.message);
      setPendingCount(0); 
    } finally {
      setLoadingPopup(false);
    }
    // --- 3. UPDATED: เพิ่ม dependency ---
  }, [showConfirmModal, loadingPopup, snoozeUntil]); 

  useEffect(() => {
    if (isLoggedIn) {
      checkPendingReceives(); 
      const intervalId = setInterval(checkPendingReceives, 600000); 
      return () => clearInterval(intervalId); 
    }
  }, [isLoggedIn, checkPendingReceives]);

  // Handlers สำหรับ Modal
  const handleModalClose = () => {
    setShowConfirmModal(false);
    // --- 4. UPDATED: ตั้งค่า Snooze 5 นาที เมื่อกด "Later" ---
    const SNOOZE_DURATION_MS = 5 * 60 * 1000; // 5 นาที
    console.log("Snoozing for 5 minutes.");
    setSnoozeUntil(Date.now() + SNOOZE_DURATION_MS);
  };

  const handleModalConfirmSuccess = () => {
    // ลบ item ที่เพิ่งทำเสร็จออกจาก list
    const remainingItems = pendingItems.slice(1);
    
    if (remainingItems.length > 0) {
      setPendingItems(remainingItems);
    } else {
      setPendingItems([]);
      setShowConfirmModal(false);
    }
    
    // --- 5. UPDATED: เคลียร์ Snooze และสั่งเช็ค Badge ใหม่ทันที ---
    setSnoozeUntil(null);
    // (เราจะปล่อยให้ checkPendingReceives ทำงานในรอบถัดไป หรือจะยิงแค่ /pending-count ก็ได้)
    // เพื่อความง่าย:
    checkPendingReceives(); // สั่งเช็คใหม่เลย (ทั้ง popup และ badge)
  };


  return (
    <Router basename="/MECHA-MATERIAL-SYSTEM">
      
      {isLoggedIn && <ConditionalNavbar user={user} onLogout={handleLogout} pendingCount={pendingCount} />}
      
      <Routes>
        {/* Public Routes */}
        <Route path="/register" element={<Register />} />
        <Route path="/login" element={<Login onLogin={handleLogin} />} />
        <Route path="/logout" element={<Logout onLogout={handleLogout} />} />
        
        {/* Protected Routes */}
        <Route path="/about" element={<ProtectedRoute><About /></ProtectedRoute>} />
        
        {/* Inventory Routes */}
        <Route path="/receive-material" element={<ProtectedRoute><ReceiveMaterial /></ProtectedRoute>} />
        <Route path="/inventory" element={<ProtectedRoute><InventoryView /></ProtectedRoute>} />
        <Route path="/transfer-material" element={<ProtectedRoute><TransferMaterial /></ProtectedRoute>} />
        <Route path="/schedule-history" element={<ProtectedRoute><ScheduleHistory /></ProtectedRoute>} />
        <Route path="/add-location" element={<ProtectedRoute><AddLocation /></ProtectedRoute>} />

        {/* Admin Routes */}
        <Route path="/item-master" element={<ProtectedRoute><ItemMaster /></ProtectedRoute>} />
        <Route path="/user" element={<ProtectedRoute><User /></ProtectedRoute>} />
        
        {/* Root Redirect */}
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Navigate to="/inventory" replace />
            </ProtectedRoute>
          }
        />
        
        {/* 404 */}
        <Route path="*" element={<NotFound />} />
      </Routes>
      
      {isLoggedIn && (
        <PendingReceiveModal
          show={showConfirmModal && pendingItems.length > 0}
          item={pendingItems[0]} 
          onHide={handleModalClose}
          onConfirmSuccess={handleModalConfirmSuccess}
        />
      )}
    </Router>
  );
};

export default App;
export { apiCall, API_BASE };