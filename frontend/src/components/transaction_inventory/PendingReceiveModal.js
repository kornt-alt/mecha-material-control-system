import React, { useState, useEffect, useMemo } from 'react';
import { Modal, Button, Form, Alert, Spinner, Row, Col } from 'react-bootstrap';
import { apiCall } from '../../App';

const PendingReceiveModal = ({ show, item, onHide, onConfirmSuccess }) => {
  const [actualQty, setActualQty] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // --- State ใหม่สำหรับ Location ---
  const [allLocations, setAllLocations] = useState([]); // [ { LOCATION_NAME: "F6", SUB_LOCATION: "RACK-A" }, ... ]
  const [loadingLoc, setLoadingLoc] = useState(false);
  
  // State สำหรับเก็บค่าที่ User เลือก
  const [selectedLocation, setSelectedLocation] = useState('');
  const [selectedSubLocation, setSelectedSubLocation] = useState('');
  // ---------------------------------

  // 1. เมื่อ item (prop) เปลี่ยน, ให้อัปเดต Qty และ Location เริ่มต้น
  useEffect(() => {
    if (item) {
      setActualQty(item.SCHEDULED_QTY.toString());
      // ตั้งค่า Location เริ่มต้นตามที่ Schedule ไว้ (ถ้ามี)
      setSelectedLocation(item.LOCATION_NAME || ''); 
      setSelectedSubLocation(item.SUB_LOCATION_NAME || ''); // (ถ้าเราเพิ่มคอลัมน์นี้ใน API)
    } else {
      setActualQty('');
      setSelectedLocation('');
      setSelectedSubLocation('');
    }
    setError('');
  }, [item]);

  // 2. เมื่อ Modal เปิด (show=true), ให้ยิง API ดึง Location List
  useEffect(() => {
    if (show) {
      const fetchLocations = async () => {
        setLoadingLoc(true);
        try {
          const locData = await apiCall('/locations');
          setAllLocations(locData);
        } catch (err) {
          setError('Failed to load locations list');
        } finally {
          setLoadingLoc(false);
        }
      };
      fetchLocations();
    }
  }, [show]);

  // 3. (Logic "เท่ๆ") สร้าง List สำหรับ Dropdown 1 (Location หลัก)
  const locationOptions = useMemo(() => {
    // เอา Location หลักที่ไม่ซ้ำกัน
    const uniqueLocations = [...new Set(allLocations.map(loc => loc.LOCATION_NAME))];
    return uniqueLocations.sort();
  }, [allLocations]);

  // 4. (Logic "เท่ๆ") สร้าง List สำหรับ Dropdown 2 (Sub Location)
  const subLocationOptions = useMemo(() => {
    if (!selectedLocation) return []; // ถ้ายังไม่เลือก Location หลัก ก็ไม่ต้องโชว์
    
    // กรอง Sub Location เฉพาะของ Location หลักที่เลือก
    return allLocations
      .filter(loc => loc.LOCATION_NAME === selectedLocation)
      .map(loc => loc.SUB_LOCATION)
      .sort();
  }, [allLocations, selectedLocation]);

  // 5. เมื่อเลือก Location หลัก -> ให้ Reset Sub Location
  const handleLocationChange = (e) => {
    setSelectedLocation(e.target.value);
    setSelectedSubLocation(''); // Reset Sub
  };
  
  // 6. อัปเดตฟังก์ชัน Confirm
  const handleConfirm = async () => {
    setLoading(true);
    setError('');

    if (isNaN(parseFloat(actualQty)) || actualQty <= 0) {
      setError('Please enter a valid actual quantity.');
      setLoading(false);
      return;
    }
    
    // (แก้ไข) เอา !selectedSubLocation ออก
    if (!selectedLocation) {
      setError('Please select a Location.');
      setLoading(false);
      return;
    }

    try {
      await apiCall(`/receive/confirm/${item.SCHEDULE_ID}`, {
        method: 'POST',
        body: JSON.stringify({
          actualQty: parseFloat(actualQty),
          locationName: selectedLocation,
          subLocation: selectedSubLocation // (ส่ง '' (ค่าว่าง) ถ้าไม่เลือก)
        }),
      });
      
      onConfirmSuccess();

    } catch (err) {
      setError(err.message || 'Failed to confirm receive');
    } finally {
      setLoading(false);
    }
  };

  if (!item) return null;

  return (
    <Modal show={show} onHide={onHide} backdrop="static" size="lg">
      <Modal.Header closeButton>
        <Modal.Title className="text-warning">
          Pending Material Receive
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error && <Alert variant="danger">...</Alert>}
        
        <h5>{item.ITEM_NO}</h5>
        <p className="text-muted">{item.ITEM_NAME || 'N/A'}</p>
        
        <p>
          <strong>Scheduled Time:</strong> {new Date(item.SCHEDULED_DATETIME).toLocaleString()} <br />
          <strong>Scheduled Qty:</strong> {item.SCHEDULED_QTY}
        </p>

        <hr />
        
        <Form.Group className="mb-3">
          <Form.Label><strong>Actual Received Qty (ที่เหลือ):</strong></Form.Label>
          <Form.Control
            type="number"
            value={actualQty}
            onChange={(e) => setActualQty(e.target.value)}
            step="any"
          />
        </Form.Group>

        {/* --- ส่วน Dropdown ใหม่ --- */}
        {loadingLoc ? (
          <div className="text-center"><Spinner /></div>
        ) : (
          <Row>
            <Col md={6}>
              <Form.Group className="mb-3">
                <Form.Label><strong>Receive to Location:</strong></Form.Label>
                <Form.Select
                  value={selectedLocation}
                  onChange={handleLocationChange}
                  isInvalid={!!error && !selectedLocation} 
                >
                  <option value="">-- Select Location --</option>
                  {locationOptions.map(locName => (
                    <option key={locName} value={locName}>{locName}</option>
                  ))}
                </Form.Select>
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group className="mb-3">
                <Form.Label><strong>Receive to Sub Location:</strong></Form.Label>
                <Form.Select
                  value={selectedSubLocation}
                  onChange={(e) => setSelectedSubLocation(e.target.value)}
                  disabled={!selectedLocation}
                  // (แก้ไข) isInvalid ไม่ต้องเช็ค subLocation
                >
                  {/* (แก้ไข) เปลี่ยน Text */}
                  <option value="">-- DEFAULT --</option>
                  {subLocationOptions.map(subLocName => (
                    <option key={subLocName} value={subLocName}>{subLocName}</option>
                  ))}
                </Form.Select>
              </Form.Group>
            </Col>
          </Row>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide}>
          Later
        </Button>
        <Button 
          variant="primary" 
          onClick={handleConfirm} 
          disabled={loading || loadingLoc}
        >
          {loading && <Spinner as="span" animation="border" size="sm" />}
          Confirm Receive
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default PendingReceiveModal;